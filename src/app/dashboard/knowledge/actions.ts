'use server';

import type { DocumentVisibility } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { setDocumentVisibility } from '@/lib/policies';
import { ingestDocument } from '@/lib/rag';

const MAX_UPLOAD_BYTES = 1_000_000; // 1 MB of plain text is plenty for now.

const VISIBILITIES: DocumentVisibility[] = ['open', 'restricted', 'confidential'];

/**
 * Ingest a document into the tenant's knowledge base.
 *
 * Trust boundary: the org comes ONLY from requireTenant() (the verified Clerk
 * session). The form supplies title + text (or a .txt file, read server-side).
 * All writes happen inside ingestDocument()'s withTenant() transaction, which
 * also writes the audit entry.
 */
export async function addDocument(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) throw new Error('Title is required.');

  const file = formData.get('file');
  let text = String(formData.get('text') ?? '').trim();
  let source: 'upload' | 'manual' = 'manual';

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error('Upload too large (max 1 MB of plain text).');
    }
    const isTxt =
      file.name.toLowerCase().endsWith('.txt') ||
      file.type === 'text/plain' ||
      file.type === '';
    if (!isTxt) throw new Error('Only .txt uploads are supported.');
    text = (await file.text()).trim();
    source = 'upload';
  }

  if (!text) throw new Error('Provide text or upload a .txt file.');

  // Untrusted form value → validate against the enum; anything else fails.
  const rawVisibility = String(formData.get('visibility') ?? 'open');
  const visibility = VISIBILITIES.find((v) => v === rawVisibility);
  if (!visibility) throw new Error('Invalid visibility.');

  const { orgId, userId } = await requireTenant();
  await ingestDocument({ orgId, actorId: userId, title, source, text, visibility });

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
