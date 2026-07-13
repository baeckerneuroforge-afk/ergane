'use server';

import { revalidatePath } from 'next/cache';
import type { LoopFlagStatus } from '@prisma/client';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { setLoopFlagStatus } from '@/lib/loop/flags';
import { requireUuid } from '@/lib/uuid';

const STATUSES: LoopFlagStatus[] = ['open', 'acked', 'resolved'];

export async function updateFlagStatus(formData: FormData) {
  const flagId = requireUuid(formData.get('flagId'), 'flagId');
  const statusRaw = String(formData.get('status') ?? '').trim();
  const status = STATUSES.find((s) => s === statusRaw);
  if (!status) throw new Error('Invalid flag status update.');

  const ctx = await requireTenant();
  await ensureOrgAndMembership({
    clerkOrgId: ctx.clerkOrgId,
    name: ctx.orgSlug ?? ctx.clerkOrgId,
    userId: ctx.userId,
    role: ctx.role,
  });
  await setLoopFlagStatus({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    flagId,
    status,
  });
  revalidatePath('/dashboard/flags');
  revalidatePath('/dashboard');
}
