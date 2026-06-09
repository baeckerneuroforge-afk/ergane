'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { withTenant } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';

/**
 * Create a knowledge item in the caller's tenant.
 *
 * Trust boundary: the org comes ONLY from requireTenant() (the verified Clerk
 * session) — never from the form. The form supplies title/body only.
 *
 * Defense-in-depth: org_id is set explicitly from the session context and the
 * write happens inside withTenant(). RLS WITH CHECK is the real enforcer; the
 * explicit equality assertion below makes a context/data mismatch fail loudly.
 */
export async function createKnowledgeItem(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!title) {
    throw new Error('Title is required.');
  }

  const { orgId, userId } = await requireTenant();

  await withTenant(orgId, async (tx) => {
    const item = await tx.knowledgeItem.create({
      data: { orgId, title, body },
    });

    // Belt-and-suspenders: the DB already guaranteed this via WITH CHECK.
    if (item.orgId !== orgId) {
      throw new Error('Tenant mismatch: refusing to persist cross-tenant data.');
    }

    await logAudit(tx, {
      orgId,
      actorId: userId,
      actorType: 'human',
      action: 'knowledge_item.create',
      target: item.id,
    });
  });

  revalidatePath('/dashboard');
}
