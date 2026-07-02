'use server';

import type { DocumentVisibility } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { setDocumentVisibility } from '@/lib/policies';
import { ExtractionError, MAX_FILE_BYTES, extractText } from '@/lib/ingest/extract';
import { deleteDocument } from '@/lib/lifecycle';
import { ingestDocument } from '@/lib/rag';

const MAX_UPLOAD_BYTES = 1_000_000; // 1 MB of plain text is plenty for now.

const VISIBILITIES: DocumentVisibility[] = ['open', 'restricted', 'confidential'];

/**
 * Ingest a manually pasted document into the tenant's knowledge base.
 * (File uploads — .pdf/.docx/.md/.txt — go through ingestUpload below.)
 *
 * Trust boundary: the org comes ONLY from requireTenant() (the verified Clerk
 * session). All writes happen inside ingestDocument()'s withTenant()
 * transaction, which also writes the audit entry.
 */
export async function addDocument(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) throw new Error('Title is required.');

  const text = String(formData.get('text') ?? '').trim();
  const source = 'manual' as const;

  if (text.length > MAX_UPLOAD_BYTES) throw new Error('Text too large (max 1 MB).');
  if (!text) throw new Error('Provide text.');

  // Untrusted form value → validate against the enum; anything else fails.
  const rawVisibility = String(formData.get('visibility') ?? 'open');
  const visibility = VISIBILITIES.find((v) => v === rawVisibility);
  if (!visibility) throw new Error('Invalid visibility.');

  const { orgId, userId } = await requireTenant();
  await ingestDocument({ orgId, actorId: userId, title, source, text, visibility });

  revalidatePath('/dashboard/knowledge');
}

export interface UploadFileResult {
  fileName: string;
  ok: boolean;
  /** Set on success. */
  chunkCount?: number;
  format?: string;
  pageCount?: number | null;
  wordCount?: number;
  /** Set on failure — user-readable reason for THIS file. */
  error?: string;
}

/**
 * Ingest ONE uploaded file (.pdf/.docx/.md/.txt) into the tenant's knowledge
 * base. Called once per file from the upload component, so each file reports
 * its own result — one broken file never kills the batch.
 *
 * Trust boundary: identical to addDocument — org only from requireTenant(),
 * extraction runs server-side, the text then goes through the EXISTING
 * ingestDocument() pipeline (chunking/embeddings/audit unchanged). Fail-closed:
 * extraction errors (scan-PDF, oversize, MIME/extension mismatch) are returned
 * as a per-file error and nothing is written.
 */
export async function ingestUpload(formData: FormData): Promise<UploadFileResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { fileName: 'unbekannt', ok: false, error: 'Keine Datei übermittelt.' };
  }
  const fileName = file.name;

  try {
    if (file.size > MAX_FILE_BYTES) {
      throw new ExtractionError(
        `Datei zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB) — Limit sind 20 MB.`,
      );
    }

    const rawVisibility = String(formData.get('visibility') ?? 'open');
    const visibility = VISIBILITIES.find((v) => v === rawVisibility);
    if (!visibility) throw new ExtractionError('Ungültige Sichtbarkeit.');

    const { text, meta } = await extractText({
      filename: fileName,
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });

    // Title from an optional form field, else the filename without extension.
    const title =
      String(formData.get('title') ?? '').trim() || fileName.replace(/\.[^.]+$/, '');

    const { orgId, userId } = await requireTenant();
    const { chunkCount } = await ingestDocument({
      orgId,
      actorId: userId,
      title,
      source: 'upload',
      text,
      visibility,
      meta: { sourceFormat: meta.format, pageCount: meta.pageCount, wordCount: meta.wordCount },
    });

    revalidatePath('/dashboard/knowledge');
    return {
      fileName,
      ok: true,
      chunkCount,
      format: meta.format,
      pageCount: meta.pageCount,
      wordCount: meta.wordCount,
    };
  } catch (err) {
    // ExtractionError carries a user-readable German message; anything else
    // gets a generic one (no stack traces to the client).
    const message =
      err instanceof ExtractionError
        ? err.message
        : 'Ingestion fehlgeschlagen — bitte erneut versuchen.';
    if (!(err instanceof ExtractionError)) console.error('ingestUpload failed:', err);
    return { fileName, ok: false, error: message };
  }
}

/**
 * Delete a document (chunks cascade). Admin gate + audit live in the lifecycle
 * function; this action parses the form and resolves the tenant/membership.
 */
export async function removeDocument(formData: FormData) {
  const documentId = String(formData.get('documentId') ?? '').trim();
  if (!documentId) throw new Error('documentId ist erforderlich.');

  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  // Mirror the membership first — deleteDocument's admin gate reads it.
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });
  await deleteDocument({ orgId, actorUserId: userId, documentId });

  revalidatePath('/dashboard/knowledge');
}

/**
 * Change a document's visibility via the EXISTING policy function — it holds
 * the admin gate (getMemberRole + requireAdmin) and writes the audit entry.
 */
export async function changeVisibility(formData: FormData) {
  const documentId = String(formData.get('documentId') ?? '').trim();
  if (!documentId) throw new Error('documentId is required.');

  const rawVisibility = String(formData.get('visibility') ?? '');
  const visibility = VISIBILITIES.find((v) => v === rawVisibility);
  if (!visibility) throw new Error('Invalid visibility.');

  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  // Mirror the membership first — setDocumentVisibility's admin gate reads it.
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });
  await setDocumentVisibility({ orgId, actorUserId: userId, documentId, visibility });

  revalidatePath('/dashboard/knowledge');
}
