// =============================================================================
// CLERK SYNC GATE (Phase 8)
//
// Closes the offboarding hole: a user removed in Clerk must lose their local
// membership — and with it approval rights and their Slack link. Calls the
// REAL webhook handler with hand-signed (Svix) requests.
//
//   1. Signature: valid accepted; invalid/expired ⇒ 401, nothing processed.
//   2. organizationMembership.deleted: membership gone, slack_user_link
//      cascaded — the person can no longer approve via Slack (end-to-end).
//   3. Role sync respects role_source: 'clerk' roles update; a locally
//      assigned 'lead' survives both the webhook AND ensureOrgAndMembership.
//   4. user.deleted: memberships in ALL orgs removed; audit actor id
//      pseudonymized in each tenant.
//   5. Idempotency: the same svix-id twice ⇒ one effect.
//   6. Unknown/unmirrored org ⇒ acked but ignored (fail-closed).
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { ensureOrgAndMembership } from '../src/lib/org';
import { setMembershipRole } from '../src/lib/policies';
import { startRun } from '../src/lib/skills';
import { clerkOrgIdToUuid } from '../src/lib/uuid';
import { computeSvixSignature } from '../src/lib/clerk/verify';
import { handleClerkWebhook } from '../src/lib/clerk/webhooks';
import { handleSlackInteractions } from '../src/lib/slack/handlers';
import { computeSlackSignature } from '../src/lib/slack/verify';
import { setSlackPoster } from '../src/lib/slack/client';
import { drainDeferredWork } from '../src/lib/slack/defer';

const CLERK_ORG_A = 'org_cs_a';
const CLERK_ORG_B = 'org_cs_b';
const ORG_A = clerkOrgIdToUuid(CLERK_ORG_A);
const ORG_B = clerkOrgIdToUuid(CLERK_ORG_B);
const ADMIN = 'cs_admin';
const LEAD = 'cs_lead';
const SECRET = `whsec_${Buffer.from('clerk-test-secret-32-bytes-long!').toString('base64')}`;
const SLACK_SECRET = 'clerk-sync-slack-secret';
const TEAM_A = 'T_CS_A';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let svixCounter = 0;

function svixRequest(payload: unknown, opts: { svixId?: string; timestamp?: number; badSig?: boolean } = {}): Request {
  const body = JSON.stringify(payload);
  const svixId = opts.svixId ?? `msg_${++svixCounter}`;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const sig = opts.badSig
    ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    : computeSvixSignature(SECRET, svixId, timestamp, body);
  return new Request('http://localhost/api/clerk/webhooks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${sig}`,
    },
    body,
  });
}

function membershipEvent(type: string, clerkOrgId: string, userId: string, role = 'org:member') {
  return { type, data: { organization: { id: clerkOrgId }, public_user_data: { user_id: userId }, role } };
}

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  for (const [orgId, clerkOrgId, name] of [
    [ORG_A, CLERK_ORG_A, 'Clerk Sync A'],
    [ORG_B, CLERK_ORG_B, 'Clerk Sync B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin', roleSource: 'clerk' } });
      await tx.membership.create({ data: { orgId, userId: LEAD, role: 'lead', roleSource: 'local' } });
    });
  }
  // Slack wiring in A: LEAD is linked and may approve.
  await withTenant(ORG_A, async (tx) => {
    await tx.slackInstallation.create({ data: { orgId: ORG_A, slackTeamId: TEAM_A } });
    await tx.slackUserLink.create({ data: { orgId: ORG_A, slackUserId: 'U_CS_LEAD', userId: LEAD } });
    await tx.approvalPolicy.create({
      data: { orgId: ORG_A, skillKey: 'beleg_kontieren', mode: 'always', approverRole: 'lead' },
    });
  });
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  process.env.CLERK_WEBHOOK_SECRET = SECRET;
  process.env.SLACK_SIGNING_SECRET = SLACK_SECRET;
  await reset();
});

afterAll(async () => {
  setSlackPoster(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await drainDeferredWork();
  setSlackPoster(async () => {});
  await reset();
  await seed();
});

// --- 1. signature -----------------------------------------------------------------

describe('svix signature (gate 1)', () => {
  it('rejects an invalid signature with 401 — nothing is processed', async () => {
    const res = await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.deleted', CLERK_ORG_A, LEAD), { badSig: true }),
    );
    expect(res.status).toBe(401);
    const still = await withTenant(ORG_A, (tx) => tx.membership.count({ where: { userId: LEAD } }));
    expect(still).toBe(1);
  });

  it('rejects an expired timestamp with 401', async () => {
    const res = await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.deleted', CLERK_ORG_A, LEAD), {
        timestamp: Math.floor(Date.now() / 1000) - 60 * 6,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature', async () => {
    const res = await handleClerkWebhook(svixRequest({ type: 'noop.event', data: {} }));
    expect(res.status).toBe(200);
  });
});

// --- 2. offboarding closes the Slack hole --------------------------------------------

describe('organizationMembership.deleted', () => {
  it('removes the membership AND cascades the slack link — no more approvals via Slack', async () => {
    // A guarded run LEAD could approve before the offboarding.
    const handle = await startRun(ORG_A, 'beleg_kontieren', { beschreibung: 'x', betragEur: 50 });
    expect(handle.status).toBe('awaiting_approval');

    const res = await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.deleted', CLERK_ORG_A, LEAD)),
    );
    expect(res.status).toBe(200);

    const after = await withTenant(ORG_A, async (tx) => ({
      membership: await tx.membership.count({ where: { userId: LEAD } }),
      slackLink: await tx.slackUserLink.count({ where: { userId: LEAD } }),
    }));
    expect(after).toEqual({ membership: 0, slackLink: 0 }); // FK cascade did its job

    // End-to-end: the former lead clicks "Freigeben" in Slack — now unlinked,
    // fail-closed, the run stays paused.
    const ts = Math.floor(Date.now() / 1000);
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: 'block_actions',
        trigger_id: 'trig_cs_1',
        team: { id: TEAM_A },
        user: { id: 'U_CS_LEAD' },
        channel: { id: 'C' },
        message: { ts: '1.2' },
        actions: [{ action_id: 'ergane_approve', value: handle.runId }],
      }),
    }).toString();
    const slackRes = await handleSlackInteractions(
      new Request('http://localhost/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': String(ts),
          'x-slack-signature': computeSlackSignature(SLACK_SECRET, ts, body),
        },
        body,
      }),
    );
    const slackBody = (await slackRes.json()) as { response_type: string };
    expect(slackBody.response_type).toBe('ephemeral'); // not linked anymore
    await drainDeferredWork();
    const run = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
    );
    expect(run.status).toBe('awaiting_approval');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'membership.removed_via_clerk' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('membership removal in A never touches B', async () => {
    await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.deleted', CLERK_ORG_A, LEAD)),
    );
    const bStill = await withTenant(ORG_B, (tx) => tx.membership.count({ where: { userId: LEAD } }));
    expect(bStill).toBe(1);
  });
});

// --- 3. role_source protects local roles ---------------------------------------------

describe('role sync respects role_source', () => {
  it('a clerk-sourced role is updated by the webhook', async () => {
    await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.updated', CLERK_ORG_A, ADMIN, 'org:member')),
    );
    const m = await withTenant(ORG_A, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ORG_A, userId: ADMIN } } }),
    );
    expect(m.role).toBe('member');
  });

  it('a locally assigned lead survives the webhook AND ensureOrgAndMembership', async () => {
    await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.updated', CLERK_ORG_A, LEAD, 'org:member')),
    );
    let m = await withTenant(ORG_A, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ORG_A, userId: LEAD } } }),
    );
    expect(m.role).toBe('lead'); // webhook did not downgrade

    await ensureOrgAndMembership({
      clerkOrgId: CLERK_ORG_A, name: 'Clerk Sync A', userId: LEAD, role: 'member',
    });
    m = await withTenant(ORG_A, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ORG_A, userId: LEAD } } }),
    );
    expect(m.role).toBe('lead'); // dashboard-load mirror did not downgrade either
  });

  it('setMembershipRole marks the role as local from then on', async () => {
    await setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN, userId: ADMIN, role: 'admin' }).catch(() => {});
    await setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN, userId: LEAD, role: 'member' });
    const m = await withTenant(ORG_A, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ORG_A, userId: LEAD } } }),
    );
    expect(m.roleSource).toBe('local');
  });

  it('membership.created mirrors a new member with role_source clerk', async () => {
    await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.created', CLERK_ORG_A, 'new_user', 'org:admin')),
    );
    const m = await withTenant(ORG_A, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId: ORG_A, userId: 'new_user' } } }),
    );
    expect(m.role).toBe('admin');
    expect(m.roleSource).toBe('clerk');
  });
});

// --- 4. user.deleted -----------------------------------------------------------------

describe('user.deleted', () => {
  it('removes the user in ALL orgs and pseudonymizes their audit trail per tenant', async () => {
    // Leave audit traces in both orgs.
    for (const orgId of [ORG_A, ORG_B]) {
      await withTenant(orgId, (tx) =>
        tx.auditLog.create({
          data: { orgId, actorId: LEAD, actorType: 'human', action: 'x.did' },
        }),
      );
    }

    const res = await handleClerkWebhook(svixRequest({ type: 'user.deleted', data: { id: LEAD } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orgs: 2 });

    for (const orgId of [ORG_A, ORG_B]) {
      const memberships = await withTenant(orgId, (tx) =>
        tx.membership.count({ where: { userId: LEAD } }),
      );
      expect(memberships).toBe(0);
      const leaked = await withTenant(orgId, (tx) =>
        tx.auditLog.count({ where: { actorId: LEAD } }),
      );
      expect(leaked, `audit in ${orgId} must not name the erased user`).toBe(0);
    }
  });
});

// --- 5./6. idempotency + unknown org ---------------------------------------------------

describe('idempotency and fail-closed org resolution', () => {
  it('the same svix-id twice has one effect', async () => {
    const payload = membershipEvent('organizationMembership.deleted', CLERK_ORG_A, LEAD);
    await handleClerkWebhook(svixRequest(payload, { svixId: 'msg_dup' }));
    const second = await handleClerkWebhook(svixRequest(payload, { svixId: 'msg_dup' }));
    expect(second.status).toBe(200);
    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.count({ where: { action: 'membership.removed_via_clerk' } }),
    );
    expect(audit).toBe(1);
  });

  it('an event for an unmirrored org is acked and ignored', async () => {
    const res = await handleClerkWebhook(
      svixRequest(membershipEvent('organizationMembership.deleted', 'org_unknown_xyz', LEAD)),
    );
    expect(res.status).toBe(200);
    const still = await withTenant(ORG_A, (tx) => tx.membership.count({ where: { userId: LEAD } }));
    expect(still).toBe(1);
  });
});
