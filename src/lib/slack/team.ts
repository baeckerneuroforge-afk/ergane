// Slack identity → tenant identity, fail-closed at every step.
//
//   resolveSlackTeam():   slack_team_id → org_id. This is the ONLY lookup in
//                          the codebase that runs without a tenant context —
//                          because the tenant IS its result. It uses the
//                          SELECT-only bootstrap policy from migration 0006:
//                          the team id is bound transaction-locally into
//                          app.slack_team_lookup (same set_config mechanics as
//                          withTenant), so the transaction can read exactly the
//                          rows of that one team and nothing else. No mapping ⇒
//                          null ⇒ the caller rejects the request.
//
//   getSlackUserLink():    slack_user_id → membership (user_id + role), read
//                          through withTenant(orgId) like all tenant data.
//                          No link, or a link whose membership vanished ⇒ null
//                          ⇒ the Slack user is role-less: open knowledge only,
//                          never acts, never approves.
import type { Role } from '@prisma/client';
import { getMemberRole } from '../policies';
import { prisma } from '../prisma';
import { withTenant } from '../tenant';

export interface SlackInstallationRef {
  orgId: string;
  /** Reference to the bot token (e.g. 'env:SLACK_BOT_TOKEN') — never the secret. */
  botTokenRef: string | null;
}

export async function resolveSlackTeam(
  slackTeamId: string | null | undefined,
): Promise<SlackInstallationRef | null> {
  if (!slackTeamId || typeof slackTeamId !== 'string') return null;

  const rows = await prisma.$transaction(async (tx) => {
    // Transaction-local GUC — automatically cleared at COMMIT, exactly like
    // withTenant()'s app.current_org. Bound as a parameter, never interpolated.
    await tx.$queryRaw`SELECT set_config('app.slack_team_lookup', ${slackTeamId}, true)`;
    return tx.$queryRaw<Array<{ org_id: string; bot_token_ref: string | null }>>`
      SELECT "org_id", "bot_token_ref" FROM "slack_installations"
      WHERE "slack_team_id" = ${slackTeamId}`;
  });

  const row = rows[0];
  if (!row) return null;
  return { orgId: row.org_id, botTokenRef: row.bot_token_ref };
}

export interface SlackUserIdentity {
  /** The mapped membership's user id — used as decided_by / actor. */
  userId: string;
  /** The membership's CURRENT role (read live, not cached on the link). */
  role: Role;
}

export async function getSlackUserLink(
  orgId: string,
  slackUserId: string | null | undefined,
): Promise<SlackUserIdentity | null> {
  if (!slackUserId || typeof slackUserId !== 'string') return null;

  return withTenant(orgId, async (tx) => {
    const link = await tx.slackUserLink.findUnique({
      where: { orgId_slackUserId: { orgId, slackUserId } },
    });
    if (!link) return null;
    const role = await getMemberRole(tx, link.userId);
    if (!role) return null; // membership gone ⇒ treat as unlinked (fail-closed)
    return { userId: link.userId, role };
  });
}
