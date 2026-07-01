// Semantic retrieval: question → query embedding → top-k tenant chunks.
//
// The similarity query runs inside withTenant(), so RLS already scopes it to
// the current tenant; the WHERE c.org_id = … predicate repeats that explicitly
// (defense-in-depth, and it lets the planner use the org_id index alongside the
// HNSW scan). `<=>` is pgvector's cosine distance; similarity = 1 - distance.
import { getEmbeddingProvider, type EmbeddingProvider } from '../ai';
import { withTenant } from '../tenant';
import { assertDimensions, toVectorLiteral } from './ingest';

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
}

export async function retrieve(input: RetrieveInput): Promise<RetrievedChunk[]> {
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

  const rows = await withTenant(input.orgId, (tx) =>
    tx.$queryRaw<
      Array<{
        chunk_id: string;
        document_id: string;
        document_title: string;
        content: string;
        ord: number;
        similarity: number;
      }>
    >`
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
      WHERE c."org_id" = ${input.orgId}::uuid
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${k}
    `,
  );

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    content: r.content,
    ord: r.ord,
    similarity: r.similarity,
  }));
}
