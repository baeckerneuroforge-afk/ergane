'use server';

// Thin server actions for the settings page: parse + validate the form, then
// delegate to the EXISTING policy functions — they hold the admin gate
// (requireAdmin inside withTenant) and write the audit entries. No governance
// logic lives here.
import type { ApprovalMode, DocumentVisibility, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { setApprovalPolicy, setMembershipRole, setVisibilityGrant } from '@/lib/policies';
import { listSkills } from '@/lib/skills';
import { createSlackInstallation, linkSlackUser, unlinkSlackUser } from '@/lib/slack/admin';
import { deleteOrganization, purgeChatHistory } from '@/lib/lifecycle';

const MODES: ApprovalMode[] = ['always', 'threshold', 'never'];
const APPROVER_ROLES: Role[] = ['lead', 'admin'];
const ASSIGNABLE_ROLES: Role[] = ['member', 'lead', 'admin'];
// The editable grant matrix ('use server' files may only export async
// functions, so the page keeps its own copy of these lists).
const GRANT_LEVELS: DocumentVisibility[] = ['restricted', 'confidential'];
const GRANT_ROLES: Role[] = ['member', 'lead', 'admin'];

/** Resolve the caller's tenant and mirror the membership (the policy
 * functions' admin gate reads it) — shared prelude of every mutation here. */
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

export async function saveApprovalPolicy(formData: FormData) {
  const skillKey = String(formData.get('skillKey') ?? '');
  if (!listSkills().some((s) => s.key === skillKey)) {
    throw new Error(`Unbekannter Skill: ${JSON.stringify(skillKey)}`);
  }

  const rawMode = String(formData.get('mode') ?? '');
  const mode = MODES.find((m) => m === rawMode);
  if (!mode) throw new Error('Ungültiger Freigabe-Modus.');

  const rawApprover = String(formData.get('approverRole') ?? 'lead');
  const approverRole = APPROVER_ROLES.find((r) => r === rawApprover);
  if (!approverRole) throw new Error('Ungültige Freigeber-Rolle.');

  let thresholdAmount: number | undefined;
  if (mode === 'threshold') {
    thresholdAmount = Number.parseFloat(
      String(formData.get('thresholdAmount') ?? '').replace(',', '.'),
    );
    if (!Number.isFinite(thresholdAmount) || thresholdAmount <= 0) {
      throw new Error('Schwelle (EUR) muss eine positive Zahl sein.');
    }
  }

  const { orgId, userId } = await requireTenantWithMembership();
  await setApprovalPolicy({ orgId, actorUserId: userId, skillKey, mode, thresholdAmount, approverRole });

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/skills');
}

/**
 * Save the whole grant matrix in one submit: every (level, role) cell is set to
 * its checkbox state. setVisibilityGrant no-ops (and skips the audit) for
 * unchanged cells, so only real changes land in the audit trail.
 */
export async function saveVisibilityGrants(formData: FormData) {
  const { orgId, userId } = await requireTenantWithMembership();

  for (const level of GRANT_LEVELS) {
    for (const role of GRANT_ROLES) {
      const allowed = formData.get(`grant:${level}:${role}`) === 'on';
      await setVisibilityGrant({ orgId, actorUserId: userId, level, role, allowed });
    }
  }

  revalidatePath('/dashboard/settings');
}

export async function saveMembershipRole(formData: FormData) {
  const targetUserId = String(formData.get('userId') ?? '').trim();
  if (!targetUserId) throw new Error('userId ist erforderlich.');

  const rawRole = String(formData.get('role') ?? '');
  const role = ASSIGNABLE_ROLES.find((r) => r === rawRole);
  if (!role) throw new Error('Ungültige Rolle.');

  const { orgId, userId } = await requireTenantWithMembership();
  await setMembershipRole({ orgId, actorUserId: userId, userId: targetUserId, role });

  revalidatePath('/dashboard/settings');
}

// -----------------------------------------------------------------------------
// Slack (admin gate + audit live in src/lib/slack/admin.ts)
// -----------------------------------------------------------------------------

export async function saveSlackInstallation(formData: FormData) {
  const slackTeamId = String(formData.get('slackTeamId') ?? '').trim();
  if (!slackTeamId) throw new Error('Slack-Team-ID ist erforderlich.');

  const { orgId, userId } = await requireTenantWithMembership();
  await createSlackInstallation({ orgId, actorUserId: userId, slackTeamId });

  revalidatePath('/dashboard/settings');
}

export async function saveSlackUserLink(formData: FormData) {
  const slackUserId = String(formData.get('slackUserId') ?? '').trim();
  const targetUserId = String(formData.get('userId') ?? '').trim();
  if (!slackUserId) throw new Error('Slack-User-ID ist erforderlich.');
  if (!targetUserId) throw new Error('Mitglied ist erforderlich.');

  const { orgId, userId } = await requireTenantWithMembership();
  await linkSlackUser({ orgId, actorUserId: userId, slackUserId, userId: targetUserId });

  revalidatePath('/dashboard/settings');
}

export async function removeSlackUserLink(formData: FormData) {
  const slackUserId = String(formData.get('slackUserId') ?? '').trim();
  if (!slackUserId) throw new Error('Slack-User-ID ist erforderlich.');

  const { orgId, userId } = await requireTenantWithMembership();
  await unlinkSlackUser({ orgId, actorUserId: userId, slackUserId });

  revalidatePath('/dashboard/settings');
}

// -----------------------------------------------------------------------------
// Lebenszyklus & Löschung (Admin-Gate + Audit in src/lib/lifecycle/)
// -----------------------------------------------------------------------------

export async function purgeChat(formData: FormData) {
  const olderThanDays = Number.parseInt(String(formData.get('olderThanDays') ?? ''), 10);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error('Aufbewahrung (Tage) muss eine Zahl ≥ 0 sein.');
  }

  const { orgId, userId } = await requireTenantWithMembership();
  await purgeChatHistory({ orgId, actorUserId: userId, olderThanDays });

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/chat');
}

export async function eraseOrganization(formData: FormData) {
  const confirmName = String(formData.get('confirmName') ?? '').trim();
  if (!confirmName) throw new Error('Bestätigung (Org-Name) ist erforderlich.');

  const { orgId, userId } = await requireTenantWithMembership();
  const proof = await deleteOrganization({ orgId, actorUserId: userId, confirmName });

  // The tenant no longer exists — log the proof server-side (the caller should
  // have exported first; the UI says so) and leave the dashboard.
  console.info('[lifecycle] organization erased:', JSON.stringify(proof));
  const { redirect } = await import('next/navigation');
  redirect('/select-org');
}
