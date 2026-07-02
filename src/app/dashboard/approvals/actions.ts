'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { approve, reject } from '@/lib/skills';

/**
 * Decide a pending approval via the EXISTING engine functions. approve()/
 * reject() validate the run state, enforce the required_role gate against the
 * caller's membership (four-eyes) and write the human audit entry — the UI
 * adds nothing on top.
 */
async function decide(runId: string, decision: 'approve' | 'reject') {
  if (!runId.trim()) throw new Error('runId is required.');

  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  // Mirror the membership first — the engine's role gate reads it.
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });

  if (decision === 'approve') {
    await approve(orgId, runId, userId);
  } else {
    await reject(orgId, runId, userId);
  }

  // Layout revalidation refreshes the sidebar badge too.
  revalidatePath('/dashboard', 'layout');
}

export async function approveRun(formData: FormData) {
  await decide(String(formData.get('runId') ?? ''), 'approve');
}

export async function rejectRun(formData: FormData) {
  await decide(String(formData.get('runId') ?? ''), 'reject');
}
