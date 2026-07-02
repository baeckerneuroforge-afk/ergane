// Admin operations for the Slack connection — used by the settings UI.
//
// Same shape as src/lib/policies/: every mutation runs inside withTenant(),
// re-checks the actor's admin role server-side (the UI gate is cosmetic), and
// writes an audit entry. MVP is manual mapping (team id typed by an admin);
// a proper OAuth install flow replaces createSlackInstallation later — the
// tables and everything downstream stay as they are.
import type { Role, SlackInstallation, SlackUserLink } from '@prisma/client';
import { logAudit } from '../audit';
import { getMemberRole } from '../policies';
import { withTenant, type Tx } from '../tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

async function requireAdmin(tx: Tx, actorUserId: string): Promise<Role> {
  const role = await getMemberRole(tx, actorUserId);
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `slack admin: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not manage the Slack connection — admin required.`,
    );
  }
  return role;
}

export interface CreateSlackInstallationInput {
  orgId: string;
  actorUserId: string;
  slackTeamId: string;
  /** Reference to the bot token (default 'env:SLACK_BOT_TOKEN') — NEVER the token. */
  botTokenRef?: string;
}

export async function createSlackInstallation(
  input: CreateSlackInstallationInput,
): Promise<SlackInstallation> {
  const slackTeamId = input.slackTeamId.trim();
  if (!slackTeamId) throw new Error('createSlackInstallation: slackTeamId is required.');
  const botTokenRef = input.botTokenRef?.trim() || 'env:SLACK_BOT_TOKEN';
  if (/^xox[a-z]-/i.test(botTokenRef)) {
    throw new Error(
      'createSlackInstallation: botTokenRef looks like a REAL Slack token — store a reference (e.g. "env:SLACK_BOT_TOKEN"), never the secret.',
    );
  }

  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    // The GLOBAL unique index on slack_team_id rejects a team that is already
    // mapped to ANOTHER org — surfaced here as a readable error.
    let created: SlackInstallation;
    try {
      created = await tx.slackInstallation.create({
        data: { orgId: input.orgId, slackTeamId, botTokenRef },
      });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new Error(
          `createSlackInstallation: Slack team ${JSON.stringify(slackTeamId)} is already mapped (a team maps to exactly ONE organization).`,
        );
      }
      throw err;
    }

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'slack.installation_created',
      target: `slack_team:${slackTeamId}`,
      detail: { via: 'settings', slackTeamId, botTokenRef },
    });
    return created;
  });
}

export interface LinkSlackUserInput {
  orgId: string;
  actorUserId: string;
  slackUserId: string;
  /** The membership's user id in THIS org (composite FK enforces it). */
  userId: string;
}

export async function linkSlackUser(input: LinkSlackUserInput): Promise<SlackUserLink> {
  const slackUserId = input.slackUserId.trim();
  const userId = input.userId.trim();
  if (!slackUserId) throw new Error('linkSlackUser: slackUserId is required.');
  if (!userId) throw new Error('linkSlackUser: userId is required.');

  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const membership = await tx.membership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId } },
    });
    if (!membership) {
      throw new Error(`linkSlackUser: no membership for user ${JSON.stringify(userId)} in this tenant.`);
    }

    // Re-linking a Slack user replaces the old link (delete + create — the
    // table has no UPDATE grant on purpose).
    const existing = await tx.slackUserLink.findUnique({
      where: { orgId_slackUserId: { orgId: input.orgId, slackUserId } },
    });
    if (existing) await tx.slackUserLink.delete({ where: { id: existing.id } });

    const link = await tx.slackUserLink.create({
      data: { orgId: input.orgId, slackUserId, userId },
    });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'slack.user_linked',
      target: `slack_user:${slackUserId}`,
      detail: { via: 'settings', slackUserId, userId, previousUserId: existing?.userId ?? null },
    });
    return link;
  });
}

export interface UnlinkSlackUserInput {
  orgId: string;
  actorUserId: string;
  slackUserId: string;
}

export async function unlinkSlackUser(input: UnlinkSlackUserInput): Promise<void> {
  await withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const existing = await tx.slackUserLink.findUnique({
      where: { orgId_slackUserId: { orgId: input.orgId, slackUserId: input.slackUserId } },
    });
    if (!existing) return;

    await tx.slackUserLink.delete({ where: { id: existing.id } });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'slack.user_unlinked',
      target: `slack_user:${input.slackUserId}`,
      detail: { via: 'settings', slackUserId: input.slackUserId, userId: existing.userId },
    });
  });
}
