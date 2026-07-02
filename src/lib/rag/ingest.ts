// Knowledge ingestion: text → chunks → embeddings → documents + chunks rows.
//
// Embeddings are produced BEFORE the transaction opens (network calls do not
// belong inside a DB transaction); the document and ALL its chunks are then
// written atomically in ONE withTenant() transaction, together with the audit
// entry. The embedding column is pgvector's vector type, which Prisma cannot
// express, so the chunk INSERT is raw SQL — org_id is still set explicitly and
// RLS WITH CHECK enforces it, exactly like every other tenant write.
import type { DocumentSource, DocumentVisibility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getEmbeddingProvider, EMBEDDING_DIMENSIONS, type EmbeddingProvider } from '../ai';
import { logAudit } from '../audit';
import { withTenant } from '../tenant';
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

  const contents = chunkText(text);
  if (contents.length === 0) throw new Error('ingestDocument: text produced no chunks.');

  const embedder = input.embedder ?? getEmbeddingProvider();
  const vectors = await embedder.embed(contents, 'document');
  if (vectors.length !== contents.length) {
    throw new Error(
      `ingestDocument: embedder returned ${vectors.length} vectors for ${contents.length} chunks.`,
    );
  }
  assertDimensions(vectors, embedder);

  return withTenant(input.orgId, async (tx) => {
    const document = await tx.document.create({
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
      action: 'knowledge.ingested',
      target: title,
    });

    return { documentId: document.id, chunkCount: contents.length };
  });
}
