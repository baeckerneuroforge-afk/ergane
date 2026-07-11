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

  // Re-ingest is admin-only (same authority as delete / visibility change) and
  // the target id must be a UUID — reject before any embedding spend.
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

  const embedder = input.embedder ?? getEmbeddingProvider();
  const vectors = await embedder.embed(contents, 'document');
  if (vectors.length !== contents.length) {
    throw new Error(
      `ingestDocument: embedder returned ${vectors.length} vectors for ${contents.length} chunks.`,
    );
  }
  assertDimensions(vectors, embedder);

  return withTenant(input.orgId, async (tx) => {
    let document;
    if (input.replaceDocumentId) {
      // Version replacement: same document id, fresh content. RLS scopes the
      // lookup — a foreign id fails as "not found". Admin gate ran above.
      const existing = await tx.document.findUniqueOrThrow({
        where: { id: input.replaceDocumentId },
      });
      await tx.chunk.deleteMany({ where: { documentId: existing.id } });
      document = await tx.document.update({
        where: { id: existing.id },
        data: {
          title,
          source: input.source,
          visibility: input.visibility ?? existing.visibility,
          sourceFormat: input.meta?.sourceFormat ?? existing.sourceFormat,
          pageCount: input.meta?.pageCount ?? null,
          wordCount: input.meta?.wordCount ?? null,
        },
      });
    } else {
      document = await tx.document.create({
        data: {
          orgId: input.orgId,
          title,
          source: input.source,
          visibility: input.visibility ?? 'open',
          sourceFormat: input.meta?.sourceFormat ?? null,
          pageCount: input.meta?.pageCount ?? null,
          wordCount: input.meta?.wordCount ?? null,
        },
      });
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
      action: input.replaceDocumentId ? 'knowledge.reingested' : 'knowledge.ingested',
      target: title,
      detail: input.replaceDocumentId ? { documentId: document.id } : undefined,
    });

    return { documentId: document.id, chunkCount: contents.length };
  });
}
