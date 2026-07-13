// Knowledge ingestion: text → chunks → embeddings → documents + chunks rows.
//
// Embeddings are produced BEFORE the transaction opens (network calls do not
// belong inside a DB transaction); the document and ALL its chunks are then
// written atomically in ONE withTenant() transaction, together with the audit
// entry. The embedding column is pgvector's vector type, which Prisma cannot
// express, so the chunk INSERT is raw SQL — org_id is still set explicitly and
// RLS WITH CHECK enforces it, exactly like every other tenant write.
import type { DocumentSource, DocumentVisibility, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getEmbeddingProvider, EMBEDDING_DIMENSIONS, type EmbeddingProvider } from '../ai';
import { logAudit } from '../audit';
import { assertWithinDailyLimit } from '../limits';
import { ADMIN_ROLES, getMemberRole } from '../policies/admin';
import { withTenant } from '../tenant';
import { isUuid } from '../uuid';
import { chunkText } from './chunking';

/** pgvector accepts its text literal '[x1,x2,…]' cast to ::vector. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export function assertDimensions(vectors: number[][], provider: EmbeddingProvider): void {
  if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding provider "${provider.name}" produces ${provider.dimensions}-dim vectors; ` +
        `the chunks.embedding column is vector(${EMBEDDING_DIMENSIONS}).`,
    );
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding provider "${provider.name}" returned a ${v.length}-dim vector, expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  }
}

/** Tool-ingested sources must never land as open (fail-closed visibility). */
const TOOL_SOURCES: ReadonlySet<DocumentSource> = new Set(['ticket', 'code', 'doc']);

/**
 * Resolve visibility: tool sources are forced to restricted (or confidential
 * if explicitly requested) — never open. Manual/upload keep the caller's choice.
 */
export function resolveIngestVisibility(
  source: DocumentSource,
  requested?: DocumentVisibility,
): DocumentVisibility {
  if (TOOL_SOURCES.has(source)) {
    return requested === 'confidential' ? 'confidential' : 'restricted';
  }
  return requested ?? 'open';
}

export interface IngestDocumentInput {
  /** Tenant key — from requireTenant() (or the demo/seed fixture), never from a client. */
  orgId: string;
  /** Who triggered the ingestion (Clerk user id or agent identifier). */
  actorId: string;
  title: string;
  source: DocumentSource;
  text: string;
  /** Disclosure level of the document (default 'open' — visible to every role). */
  visibility?: DocumentVisibility;
  /**
   * Optional ingestion metadata from the extraction layer (0005) — stored on
   * the document row, pipeline otherwise unchanged.
   */
  meta?: {
    sourceFormat?: string;
    pageCount?: number | null;
    wordCount?: number | null;
  };
  /**
   * Stable external identity (e.g. `linear:issue:<uuid>`). When set, a second
   * ingest with the same (org, externalRef) UPDATES the existing document
   * (chunk replace) instead of creating a duplicate — the tool-dedup path.
   */
  externalRef?: string;
  /**
   * Structured tool fields for the loop (dueDate, state, assigneeId, …).
   * Stored as documents.source_meta JSONB.
   */
  sourceMeta?: Record<string, unknown>;
  /** Injectable for tests/demo; defaults to the env-selected provider. */
  embedder?: EmbeddingProvider;
  /**
   * Re-ingest: replace THIS existing document's content in one transaction
   * (old chunks deleted, new chunks written, document row updated, audit
   * 'knowledge.reingested'). The id must belong to the caller's tenant — a
   * foreign id is "not found" under RLS. The document keeps its id, so
   * nothing referencing it breaks; retrieval sees only the new version.
   */
  replaceDocumentId?: string;
}

export interface IngestDocumentResult {
  documentId: string;
  chunkCount: number;
}

export async function ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
  const title = input.title.trim();
  const text = input.text.trim();
  if (!title) throw new Error('ingestDocument: title is required.');
  if (!text) throw new Error('ingestDocument: text is required.');

  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef !== undefined && !externalRef) {
    throw new Error('ingestDocument: externalRef must be non-empty when provided.');
  }

  // Re-ingest is admin-only (same authority as delete / visibility change) and
  // the target id must be a UUID — reject before any embedding spend.
  // Tool externalRef upserts are NOT admin-gated (agent path); human re-ingest is.
  if (input.replaceDocumentId !== undefined) {
    if (!isUuid(input.replaceDocumentId)) {
      throw new Error('ingestDocument: replaceDocumentId must be a UUID.');
    }
    await withTenant(input.orgId, async (tx) => {
      const role: Role | null = await getMemberRole(tx, input.actorId);
      if (!role || !ADMIN_ROLES.includes(role)) {
        throw new Error(
          `ingestDocument: user ${JSON.stringify(input.actorId)} (role: ${role ?? 'none'}) may not reingest — admin required.`,
        );
      }
    });
  }

  const contents = chunkText(text);
  if (contents.length === 0) throw new Error('ingestDocument: text produced no chunks.');

  // Kostenschutz VOR dem ersten bezahlten Aufruf (Embeddings).
  await withTenant(input.orgId, (tx) => assertWithinDailyLimit(tx, 'ingest'));

  // Resolve existing doc by externalRef BEFORE embedding spend when possible —
  // still embed (content may have changed); we only need the id for replace.
  let replaceId = input.replaceDocumentId;
  if (!replaceId && externalRef) {
    const existing = await withTenant(input.orgId, (tx) =>
      tx.document.findFirst({
        where: { externalRef },
        select: { id: true },
      }),
    );
    if (existing) replaceId = existing.id;
  }

  const embedder = input.embedder ?? getEmbeddingProvider();
  const vectors = await embedder.embed(contents, 'document');
  if (vectors.length !== contents.length) {
    throw new Error(
      `ingestDocument: embedder returned ${vectors.length} vectors for ${contents.length} chunks.`,
    );
  }
  assertDimensions(vectors, embedder);

  const sourceMeta =
    input.sourceMeta !== undefined ? (input.sourceMeta as Prisma.InputJsonValue) : undefined;
  const isReplace = Boolean(replaceId);

  return withTenant(input.orgId, async (tx) => {
    let document;
    if (replaceId) {
      // Version replacement: same document id, fresh content. RLS scopes the
      // lookup — a foreign id fails as "not found". Admin gate ran for human
      // replaceDocumentId; externalRef path is the tool upsert.
      const existing = await tx.document.findUniqueOrThrow({
        where: { id: replaceId },
      });
      // Preserve existing visibility when the caller does not pass one — except
      // tool sources, which stay fail-closed (never open).
      const visibility = TOOL_SOURCES.has(input.source)
        ? resolveIngestVisibility(input.source, input.visibility)
        : (input.visibility ?? existing.visibility);
      await tx.chunk.deleteMany({ where: { documentId: existing.id } });
      document = await tx.document.update({
        where: { id: existing.id },
        data: {
          title,
          source: input.source,
          visibility,
          sourceFormat: input.meta?.sourceFormat ?? existing.sourceFormat,
          pageCount: input.meta?.pageCount ?? null,
          wordCount: input.meta?.wordCount ?? null,
          ...(externalRef !== undefined ? { externalRef } : {}),
          ...(sourceMeta !== undefined ? { sourceMeta } : {}),
        },
      });
    } else {
      const visibility = resolveIngestVisibility(input.source, input.visibility);
      try {
        document = await tx.document.create({
          data: {
            orgId: input.orgId,
            title,
            source: input.source,
            visibility,
            sourceFormat: input.meta?.sourceFormat ?? null,
            pageCount: input.meta?.pageCount ?? null,
            wordCount: input.meta?.wordCount ?? null,
            externalRef: externalRef ?? null,
            sourceMeta: sourceMeta ?? Prisma.JsonNull,
          },
        });
      } catch (err) {
        // Race: concurrent externalRef upsert — fall back to replace path.
        if (
          externalRef &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await tx.document.findFirst({
            where: { externalRef },
            select: { id: true, visibility: true, sourceFormat: true },
          });
          if (!raced) throw err;
          await tx.chunk.deleteMany({ where: { documentId: raced.id } });
          document = await tx.document.update({
            where: { id: raced.id },
            data: {
              title,
              source: input.source,
              visibility: TOOL_SOURCES.has(input.source)
                ? visibility
                : (input.visibility ?? raced.visibility),
              sourceFormat: input.meta?.sourceFormat ?? raced.sourceFormat,
              pageCount: input.meta?.pageCount ?? null,
              wordCount: input.meta?.wordCount ?? null,
              externalRef,
              ...(sourceMeta !== undefined ? { sourceMeta } : {}),
            },
          });
        } else {
          throw err;
        }
      }
    }
    // Belt-and-suspenders: WITH CHECK already guaranteed this.
    if (document.orgId !== input.orgId) {
      throw new Error('Tenant mismatch: refusing to persist cross-tenant data.');
    }

    // One multi-row INSERT; embedding goes in as a pgvector text literal.
    const rows = contents.map(
      (content, i) =>
        Prisma.sql`(${input.orgId}::uuid, ${document.id}::uuid, ${content}, ${toVectorLiteral(vectors[i])}::vector, ${i})`,
    );
    await tx.$executeRaw`
      INSERT INTO "chunks" ("org_id", "document_id", "content", "embedding", "ord")
      VALUES ${Prisma.join(rows)}
    `;

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorId,
      actorType: 'agent',
      action: isReplace ? 'knowledge.reingested' : 'knowledge.ingested',
      target: title,
      detail: {
        documentId: document.id,
        ...(externalRef ? { externalRef } : {}),
        ...(input.source ? { source: input.source } : {}),
      },
    });

    return { documentId: document.id, chunkCount: contents.length };
  });
}
