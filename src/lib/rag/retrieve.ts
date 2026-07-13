// Semantic retrieval: question → query embedding → top-k tenant chunks.
//
// The similarity query runs inside withTenant(), so RLS already scopes it to
// the current tenant; the WHERE c.org_id = … predicate repeats that explicitly
// (defense-in-depth, and it lets the planner use the org_id index alongside the
// HNSW scan). `<=>` is pgvector's cosine distance; similarity = 1 - distance.
//
// Disclosure filter (Phase 4): the asker's ROLE decides which documents are
// even searchable — IN SQL, before any LLM ever sees a chunk. 'open' documents
// are always visible; 'restricted'/'confidential' require a visibility_grant
// for the role (visibility_grants is itself RLS'd, so only the tenant's own
// grants apply). No role / unknown role / no grant ⇒ only 'open' (fail-closed).
import type { Role } from '@prisma/client';
import { getEmbeddingProvider, type EmbeddingProvider } from '../ai';
import { withTenant } from '../tenant';
import { assertDimensions, toVectorLiteral } from './ingest';

const KNOWN_ROLES: ReadonlyArray<string> = ['owner', 'admin', 'lead', 'member'];

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  /** The document title — surfaced to the user as the SOURCE of the answer. */
  documentTitle: string;
  content: string;
  ord: number;
  /** Cosine similarity in [-1, 1]; higher = more relevant. */
  similarity: number;
}

export interface RetrieveInput {
  orgId: string;
  query: string;
  k?: number;
  embedder?: EmbeddingProvider;
  /**
   * Role of the asker (from the verified session / demo fixture). Omitted or
   * unknown ⇒ only 'open' documents are searched (fail-closed).
   */
  role?: Role;
}

export interface RetrieveWithTraceResult {
  chunks: RetrievedChunk[];
  /**
   * How many of the top-k nearest hits (at/above `minSimilarity`) were hidden
   * by the asker's role. A bare COUNT computed in SQL — the filtered rows'
   * content/titles/ids never leave the database (disclosure invariant).
   */
  filteredCount: number;
}

interface ValidatedRetrieve {
  k: number;
  literal: string;
  roleText: string;
}

async function prepare(input: RetrieveInput): Promise<ValidatedRetrieve> {
  const query = input.query.trim();
  if (!query) throw new Error('retrieve: query is required.');
  const k = input.k ?? 5;
  if (!Number.isInteger(k) || k <= 0 || k > 50) {
    throw new Error('retrieve: k must be an integer in [1, 50].');
  }

  const embedder = input.embedder ?? getEmbeddingProvider();
  const [queryVector] = await embedder.embed([query], 'query');
  assertDimensions([queryVector], embedder);
  const literal = toVectorLiteral(queryVector);

  // Compared as text against g."role"::text — an unknown value simply matches
  // no grant (fail-closed) instead of raising an enum-cast error.
  const roleText = input.role && KNOWN_ROLES.includes(input.role) ? input.role : '';

  return { k, literal, roleText };
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

type VisibleRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  ord: number;
  similarity: number;
};

function searchVisible(
  tx: Tx,
  orgId: string,
  { k, literal, roleText }: ValidatedRetrieve,
): Promise<VisibleRow[]> {
  return tx.$queryRaw`
    SELECT
      c."id"          AS chunk_id,
      c."document_id" AS document_id,
      d."title"       AS document_title,
      c."content",
      c."ord",
      1 - (c."embedding" <=> ${literal}::vector) AS similarity
    FROM "chunks" c
    JOIN "documents" d
      ON d."id" = c."document_id" AND d."org_id" = c."org_id"
    WHERE c."org_id" = ${orgId}::uuid
      AND (
        d."visibility" = 'open'
        OR EXISTS (
          SELECT 1 FROM "visibility_grants" g
          WHERE g."org_id" = c."org_id"
            AND g."level" = d."visibility"
            AND g."role"::text = ${roleText}
        )
      )
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${k}
  `;
}

/**
 * ONE round-trip: top-k visible chunks (same as searchVisible) PLUS
 * filteredCount among the top-k unfiltered nearest (hidden + ≥ minSimilarity).
 * Disclosure invariant: only COUNT leaves SQL for hidden hits — no titles/ids.
 */
function searchVisibleWithTrace(
  tx: Tx,
  orgId: string,
  { k, literal, roleText }: ValidatedRetrieve,
  minSimilarity: number,
): Promise<
  Array<{
    chunk_id: string | null;
    document_id: string | null;
    document_title: string | null;
    content: string | null;
    ord: number | null;
    similarity: number | null;
    filtered_count: number;
  }>
> {
  // Two CTEs in a single statement: visible_top preserves retrieve() semantics;
  // nearest feeds only the COUNT of role-hidden near hits (no content leakage).
  return tx.$queryRaw`
    WITH visible_top AS (
      SELECT
        c."id"          AS chunk_id,
        c."document_id" AS document_id,
        d."title"       AS document_title,
        c."content",
        c."ord",
        1 - (c."embedding" <=> ${literal}::vector) AS similarity,
        (c."embedding" <=> ${literal}::vector) AS dist
      FROM "chunks" c
      JOIN "documents" d
        ON d."id" = c."document_id" AND d."org_id" = c."org_id"
      WHERE c."org_id" = ${orgId}::uuid
        AND (
          d."visibility" = 'open'
          OR EXISTS (
            SELECT 1 FROM "visibility_grants" g
            WHERE g."org_id" = c."org_id"
              AND g."level" = d."visibility"
              AND g."role"::text = ${roleText}
          )
        )
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${k}
    ),
    nearest AS (
      SELECT
        1 - (c."embedding" <=> ${literal}::vector) AS similarity,
        (
          d."visibility" = 'open'
          OR EXISTS (
            SELECT 1 FROM "visibility_grants" g
            WHERE g."org_id" = c."org_id"
              AND g."level" = d."visibility"
              AND g."role"::text = ${roleText}
          )
        ) AS visible
      FROM "chunks" c
      JOIN "documents" d
        ON d."id" = c."document_id" AND d."org_id" = c."org_id"
      WHERE c."org_id" = ${orgId}::uuid
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${k}
    ),
    filtered AS (
      SELECT COUNT(*)::int AS filtered_count
      FROM nearest n
      WHERE NOT n."visible"
        AND n."similarity" >= ${minSimilarity}
    )
    SELECT
      v.chunk_id,
      v.document_id,
      v.document_title,
      v.content,
      v.ord,
      v.similarity,
      f.filtered_count
    FROM filtered f
    LEFT JOIN visible_top v ON true
    ORDER BY v.dist ASC NULLS LAST
  `;
}

function toRetrievedChunks(rows: VisibleRow[]): RetrievedChunk[] {
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    content: r.content,
    ord: r.ord,
    similarity: r.similarity,
  }));
}

export async function retrieve(input: RetrieveInput): Promise<RetrievedChunk[]> {
  const prepared = await prepare(input);
  const rows = await withTenant(input.orgId, (tx) => searchVisible(tx, input.orgId, prepared));
  return toRetrievedChunks(rows);
}

/**
 * Like retrieve(), but additionally reports how many nearby hits the role
 * disclosure filter hid — as a NUMBER only. Basis of the "Why this answer?"
 * trace. `minSimilarity` should be the embedder's relevance threshold so the
 * count means "hits that would have been used".
 *
 * Uses a single SQL round-trip (searchVisibleWithTrace) instead of two
 * sequential vector scans.
 */
export async function retrieveWithTrace(
  input: RetrieveInput & { minSimilarity?: number },
): Promise<RetrieveWithTraceResult> {
  const prepared = await prepare(input);
  const minSimilarity = input.minSimilarity ?? 0;
  const rows = await withTenant(input.orgId, (tx) =>
    searchVisibleWithTrace(tx, input.orgId, prepared, minSimilarity),
  );
  const filteredCount = rows[0]?.filtered_count ?? 0;
  const chunks = rows
    .filter((r): r is typeof r & {
      chunk_id: string;
      document_id: string;
      document_title: string;
      content: string;
      ord: number;
      similarity: number;
    } => r.chunk_id != null)
    .map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      content: r.content,
      ord: r.ord,
      similarity: r.similarity,
    }));
  return { chunks, filteredCount };
}
