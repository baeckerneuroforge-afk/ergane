'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { deleteArtifact, getArtifactContent } from '@/lib/artifacts';
import { requireUuid } from '@/lib/uuid';

async function requireTenantWithMembership() {
  const ctx = await requireTenant();
  await ensureOrgAndMembership({
    clerkOrgId: ctx.clerkOrgId,
    name: ctx.orgSlug ?? ctx.clerkOrgId,
    userId: ctx.userId,
    role: ctx.role,
  });
  return ctx;
}

export async function removeArtifact(formData: FormData) {
  const artifactId = requireUuid(formData.get('artifactId'), 'artifactId');

  const { orgId, userId } = await requireTenantWithMembership();
  await deleteArtifact({ orgId, actorUserId: userId, artifactId });

  revalidatePath('/dashboard/deliverables');
}

export async function downloadArtifact(formData: FormData): Promise<string> {
  const artifactId = requireUuid(formData.get('artifactId'), 'artifactId');

  const { orgId } = await requireTenantWithMembership();
  const content = await getArtifactContent(orgId, artifactId);
  if (!content) throw new Error('Artifact content not found.');

  const base64 = Buffer.from(content.bytes).toString('base64');
  return `data:${content.contentType};base64,${base64}`;
}
