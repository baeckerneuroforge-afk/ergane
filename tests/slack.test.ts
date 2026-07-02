// =============================================================================
// SLACK ADAPTER GATE (Phase 6)
//
// Slack is the first EXTERNAL entry point (no Clerk session), so this suite
// proves the fail-closed chain end-to-end, calling the REAL route handlers
// with hand-signed Requests (same functions the Next routes export):
//
//   1. Signature: valid accepted; invalid / expired / tampered ⇒ 401, nothing
//      is processed.
//   2. Team → org: unmapped team ⇒ 403 on all three endpoints; mapped team runs
//      through withTenant(orgId) — Team A can NEVER reach org B's data.
//   3. User → role: unlinked Slack user gets open knowledge only and can
//      neither start skills nor approve; linked users act with their CURRENT
//      membership role (approval role gate enforced by the engine).
//   4. Disclosure via Slack: answerQuestion honors visibility grants — no
//      confidential leak to under-privileged roles.
//   5. Audit: every Slack action lands in the tenant audit_log with the
//      "via slack" marker.
//   6. RLS regression: both new tables ENABLE + FORCE, 0 rows without context.
//
// Runs as `app_user` (DATABASE_URL) like the app; owner connection only resets.
// No network: fake AI providers, and outgoing Slack messages are captured via
// setSlackPoster().
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { ingestDocument, NO_KNOWLEDGE_ANSWER, SOURCES_MARKER } from '../src/lib/rag';
import { computeSlackSignature, verifySlackSignature } from '../src/lib/slack/verify';
import {
  handleSlackCommands,
  handleSlackEvents,
  handleSlackInteractions,
} from '../src/lib/slack/handlers';
import { setSlackPoster, type SlackOutgoingMessage } from '../src/lib/slack/client';
import { resolveSlackTeam } from '../src/lib/slack/team';

const ORG_A = '99999999-9999-4999-8999-999999999999';
const ORG_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_A = 'T_SLACK_ORG_A';
const TEAM_UNKNOWN = 'T_NOT_MAPPED';
const SECRET = 'slack-test-signing-secret';

// Org A memberships and their Slack links.
const LEAD = { userId: 'alice_lead', role: 'lead' as const, slackId: 'U_LEAD' };
const MEMBER = { userId: 'bob_member', role: 'member' as const, slackId: 'U_MEMBER' };
const STRANGER_SLACK_ID = 'U_STRANGER'; // no link, no membership

const NEW_TABLES = ['slack_installations', 'slack_user_links'];
const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  ...NEW_TABLES,
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

/** Outgoing Slack messages captured instead of hitting the Slack API. */
let posted: SlackOutgoingMessage[] = [];

// --- signed-request builders -------------------------------------------------

function signedRequest(
  body: string,
  opts: { contentType?: string; timestamp?: number; signature?: string } = {},
): Request {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = opts.signature ?? computeSlackSignature(SECRET, timestamp, body);
  return new Request('http://localhost/api/slack/test', {
    method: 'POST',
    headers: {
      'content-type': opts.contentType ?? 'application/json',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': signature,
    },
    body,
  });
}

function mentionEvent(teamId: string, slackUserId: string, text: string): Request {
  return signedRequest(
    JSON.stringify({
      type: 'event_callback',
      team_id: teamId,
      event: { type: 'app_mention', user: slackUserId, text, channel: 'C_TEST', ts: '111.222' },
    }),
  );
}

function commandRequest(teamId: string, slackUserId: string, text: string): Request {
  const body = new URLSearchParams({
    command: '/ergane',
    team_id: teamId,
    user_id: slackUserId,
    channel_id: 'C_TEST',
    text,
  }).toString();
  return signedRequest(body, { contentType: 'application/x-www-form-urlencoded' });
}

function interactionRequest(
  teamId: string,
  slackUserId: string,
  actionId: 'ergane_approve' | 'ergane_reject',
  runId: string,
): Request {
  const payload = {
    type: 'block_actions',
    team: { id: teamId },
    user: { id: slackUserId },
    channel: { id: 'C_TEST' },
    message: { ts: '111.222' },
    actions: [{ action_id: actionId, value: runId }],
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  return signedRequest(body, { contentType: 'application/x-www-form-urlencoded' });
}

// --- seeding helpers -----------------------------------------------------------

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_slack_a', name: 'Slack Org A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: LEAD.userId, role: LEAD.role } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER.userId, role: MEMBER.role } });
    await tx.slackInstallation.create({
      data: { orgId: ORG_A, slackTeamId: TEAM_A, botTokenRef: 'env:SLACK_BOT_TOKEN' },
    });
    await tx.slackUserLink.create({
      data: { orgId: ORG_A, slackUserId: LEAD.slackId, userId: LEAD.userId },
    });
    await tx.slackUserLink.create({
      data: { orgId: ORG_A, slackUserId: MEMBER.slackId, userId: MEMBER.userId },
    });
    // 'confidential' is visible to leads only (grant); members/unlinked see nothing.
    await tx.visibilityGrant.create({ data: { orgId: ORG_A, level: 'confidential', role: 'lead' } });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_slack_b', name: 'Slack Org B' } });
  });

  // Knowledge: A has an open doc and a confidential doc; B has its own open doc.
  await ingestDocument({
    orgId: ORG_A,
    actorId: 'seed',
    title: 'Urlaubsrichtlinie',
    source: 'manual',
    text: 'Alle Mitarbeitenden haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
  });
  await ingestDocument({
    orgId: ORG_A,
    actorId: 'seed',
    title: 'Gehaltsbänder',
    source: 'manual',
    visibility: 'confidential',
    text: 'Das Gehaltsband für Senior Engineers liegt bei 95000 Euro Jahresgehalt.',
  });
  await ingestDocument({
    orgId: ORG_B,
    actorId: 'seed',
    title: 'Kündigungsfristen',
    source: 'manual',
    text: 'Die Kündigungsfrist für Lieferverträge beträgt drei Monate zum Quartalsende.',
  });
}

/** Start a guarded run via the slash command and return its runId (from the
 * approve button's value). Requires the 'always'/lead policy from seedPolicy(). */
async function startGuardedRun(): Promise<string> {
  const res = await handleSlackCommands(
    commandRequest(TEAM_A, MEMBER.slackId, 'skill beleg_kontieren {"beschreibung":"Lizenz","betragEur":1240}'),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { text: string; blocks?: Array<{ elements?: Array<{ action_id: string; value: string }> }> };
  const buttons = body.blocks?.find((b) => Array.isArray(b.elements))?.elements ?? [];
  const approveButton = buttons.find((b) => b.action_id === 'ergane_approve');
  expect(approveButton?.value).toBeTruthy();
  return approveButton!.value;
}

async function seedPolicy() {
  await withTenant(ORG_A, (tx) =>
    tx.approvalPolicy.create({
      data: { orgId: ORG_A, skillKey: 'beleg_kontieren', mode: 'always', approverRole: 'lead' },
    }),
  );
}

async function runStatus(orgId: string, runId: string) {
  return withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.findUnique({ where: { id: runId } });
    return run?.status ?? null;
  });
}

async function slackAudit(orgId: string, action: string) {
  return withTenant(orgId, (tx) => tx.auditLog.findMany({ where: { action } }));
}

// --- lifecycle -----------------------------------------------------------------

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Refusing to run: connected as "${role?.current_user}" (super=${role?.rolsuper}, bypassrls=${role?.rolbypassrls}).`,
    );
  }
  process.env.SLACK_SIGNING_SECRET = SECRET;
  await reset();
});

afterAll(async () => {
  setSlackPoster(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  posted = [];
  setSlackPoster(async (msg) => {
    posted.push(msg);
  });
  await reset();
  await seed();
});

// --- 1. signature ---------------------------------------------------------------

describe('signature verification (gate 1 — before ANYTHING is processed)', () => {
  it('accepts a validly signed request (url_verification challenge)', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'chlg_123' });
    const res = await handleSlackEvents(signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'chlg_123' });
  });

  it('rejects an invalid signature with 401 and does not process the event', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: TEAM_A,
      event: { type: 'app_mention', user: LEAD.slackId, text: 'Urlaubstage?', channel: 'C', ts: '1.2' },
    });
    const res = await handleSlackEvents(
      signedRequest(body, { signature: 'v0=deadbeef'.padEnd(67, '0') }),
    );
    expect(res.status).toBe(401);
    expect(posted).toHaveLength(0);
    // Nothing reached the tenant: no chat messages, no audit.
    const messages = await withTenant(ORG_A, (tx) => tx.chatMessage.count());
    expect(messages).toBe(0);
  });

  it('rejects an expired timestamp (replay window) with 401', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'x' });
    const stale = Math.floor(Date.now() / 1000) - 60 * 6; // outside ±5 min
    const res = await handleSlackEvents(signedRequest(body, { timestamp: stale }));
    expect(res.status).toBe(401);
  });

  it('rejects a signature made for a DIFFERENT body (tamper protection)', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureForOtherBody = computeSlackSignature(SECRET, timestamp, '{"type":"benign"}');
    const res = await handleSlackCommands(
      signedRequest('command=%2Fergane&text=frage+x&team_id=' + TEAM_A, {
        contentType: 'application/x-www-form-urlencoded',
        timestamp,
        signature: signatureForOtherBody,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('verifySlackSignature fails closed on missing secret/headers', () => {
    const base = { signingSecret: SECRET, rawBody: 'b', timestampHeader: '1', signatureHeader: 'v0=x' };
    expect(verifySlackSignature({ ...base, signingSecret: '' })).toBe(false);
    expect(verifySlackSignature({ ...base, timestampHeader: null })).toBe(false);
    expect(verifySlackSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifySlackSignature({ ...base, timestampHeader: 'not-a-number' })).toBe(false);
  });
});

// --- 2. team → org ---------------------------------------------------------------

describe('team → org mapping (gate 2 — no mapping ⇒ rejected)', () => {
  it('rejects an unmapped team with 403 on all three endpoints', async () => {
    const events = await handleSlackEvents(mentionEvent(TEAM_UNKNOWN, LEAD.slackId, 'Urlaubstage?'));
    expect(events.status).toBe(403);

    const commands = await handleSlackCommands(commandRequest(TEAM_UNKNOWN, LEAD.slackId, 'frage Urlaubstage?'));
    expect(commands.status).toBe(403);

    const interactions = await handleSlackInteractions(
      interactionRequest(TEAM_UNKNOWN, LEAD.slackId, 'ergane_approve', ORG_A),
    );
    expect(interactions.status).toBe(403);

    expect(posted).toHaveLength(0);
  });

  it('team A NEVER reaches org B: B-only knowledge is invisible via team A', async () => {
    // The question matches ORG_B's document ("Kündigungsfrist Lieferverträge") —
    // but team A resolves to ORG_A, so retrieval finds nothing.
    const res = await handleSlackEvents(
      mentionEvent(TEAM_A, LEAD.slackId, 'Welche Kündigungsfrist gilt für Lieferverträge?'),
    );
    expect(res.status).toBe(200);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toContain(NO_KNOWLEDGE_ANSWER);
    expect(posted[0]!.text).not.toContain('drei Monate');

    // The interaction landed in A's history/audit — and NOT in B's.
    const aMessages = await withTenant(ORG_A, (tx) => tx.chatMessage.count());
    const bMessages = await withTenant(ORG_B, (tx) => tx.chatMessage.count());
    expect(aMessages).toBe(2); // question + answer
    expect(bMessages).toBe(0);
  });

  it('resolveSlackTeam maps a known team and fails closed for unknown/empty', async () => {
    expect((await resolveSlackTeam(TEAM_A))?.orgId).toBe(ORG_A);
    expect(await resolveSlackTeam(TEAM_UNKNOWN)).toBeNull();
    expect(await resolveSlackTeam('')).toBeNull();
    expect(await resolveSlackTeam(undefined)).toBeNull();
  });
});

// --- 3./4. user link + disclosure -------------------------------------------------

describe('slack user → role (gate 3) and disclosure via Slack', () => {
  it('an UNLINKED slack user gets open knowledge (with sources)', async () => {
    const res = await handleSlackEvents(
      mentionEvent(TEAM_A, STRANGER_SLACK_ID, 'Wie viele Urlaubstage pro Kalenderjahr?'),
    );
    expect(res.status).toBe(200);
    expect(posted[0]!.text).toContain('30 Urlaubstage');
    expect(posted[0]!.text).toContain(`${SOURCES_MARKER} Urlaubsrichtlinie`);
  });

  it('an UNLINKED slack user gets NO confidential knowledge (fail-closed)', async () => {
    const res = await handleSlackEvents(
      mentionEvent(TEAM_A, STRANGER_SLACK_ID, 'Wie hoch ist das Gehaltsband für Senior Engineers?'),
    );
    expect(res.status).toBe(200);
    expect(posted[0]!.text).toContain(NO_KNOWLEDGE_ANSWER);
    expect(posted[0]!.text).not.toContain('95000');
  });

  it('a linked MEMBER (no grant) gets no confidential knowledge either', async () => {
    const res = await handleSlackCommands(
      commandRequest(TEAM_A, MEMBER.slackId, 'frage Wie hoch ist das Gehaltsband für Senior Engineers?'),
    );
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain(NO_KNOWLEDGE_ANSWER);
    expect(body.text).not.toContain('95000');
  });

  it('a linked LEAD (grant for confidential) gets the confidential answer', async () => {
    const res = await handleSlackCommands(
      commandRequest(TEAM_A, LEAD.slackId, 'frage Wie hoch ist das Gehaltsband für Senior Engineers?'),
    );
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain('95000');
    expect(body.text).toContain(`${SOURCES_MARKER} Gehaltsbänder`);
  });

  it('every slack question writes a tenant audit entry marked "via slack"', async () => {
    await handleSlackEvents(mentionEvent(TEAM_A, LEAD.slackId, 'Wie viele Urlaubstage?'));
    const entries = await slackAudit(ORG_A, 'slack.question_answered');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBe(`slack:${LEAD.slackId}`);
    expect(entries[0]!.actorType).toBe('human');
    expect((entries[0]!.detail as { via?: string }).via).toBe('slack');
  });
});

// --- skills via slash command ------------------------------------------------------

describe('/ergane skill — start runs from Slack', () => {
  it('an UNLINKED slack user can NOT start a skill (no run is created)', async () => {
    const res = await handleSlackCommands(
      commandRequest(TEAM_A, STRANGER_SLACK_ID, 'skill beleg_kontieren {"beschreibung":"x","betragEur":10}'),
    );
    const body = (await res.json()) as { response_type: string };
    expect(body.response_type).toBe('ephemeral');
    const runs = await withTenant(ORG_A, (tx) => tx.skillRun.count());
    expect(runs).toBe(0);
  });

  it('a guarded run pauses awaiting_approval and returns Freigeben/Ablehnen buttons', async () => {
    await seedPolicy();
    const runId = await startGuardedRun();
    expect(await runStatus(ORG_A, runId)).toBe('awaiting_approval');

    const started = await slackAudit(ORG_A, 'slack.skill_started');
    expect(started).toHaveLength(1);
    expect((started[0]!.detail as { via?: string }).via).toBe('slack');
  });

  it('a smuggled "rolle" in the JSON args is overwritten by the verified link role', async () => {
    const res = await handleSlackCommands(
      commandRequest(TEAM_A, MEMBER.slackId, 'skill wissen_zusammenfassen {"frage":"Gehaltsband Senior Engineers?","rolle":"admin"}'),
    );
    expect(res.status).toBe(200);
    const run = await withTenant(ORG_A, (tx) => tx.skillRun.findFirstOrThrow());
    expect((run.input as { rolle?: string }).rolle).toBe('member');
  });
});

// --- approvals via buttons -----------------------------------------------------------

describe('approvals via Slack buttons (role gate enforced by the engine)', () => {
  it('an UNLINKED slack user can NOT approve — run stays awaiting_approval', async () => {
    await seedPolicy();
    const runId = await startGuardedRun();

    const res = await handleSlackInteractions(
      interactionRequest(TEAM_A, STRANGER_SLACK_ID, 'ergane_approve', runId),
    );
    const body = (await res.json()) as { response_type: string };
    expect(body.response_type).toBe('ephemeral');
    expect(await runStatus(ORG_A, runId)).toBe('awaiting_approval');

    const denied = await slackAudit(ORG_A, 'slack.approval_denied');
    expect(denied).toHaveLength(1);
    // The denial notice went out as an ephemeral message.
    const ephemeral = posted.find((m) => m.ephemeralUserId === STRANGER_SLACK_ID);
    expect(ephemeral).toBeTruthy();
  });

  it('a linked MEMBER cannot approve when required_role=lead — ephemeral error, no action', async () => {
    await seedPolicy();
    const runId = await startGuardedRun();

    const res = await handleSlackInteractions(
      interactionRequest(TEAM_A, MEMBER.slackId, 'ergane_approve', runId),
    );
    const body = (await res.json()) as { response_type: string };
    expect(body.response_type).toBe('ephemeral');
    expect(await runStatus(ORG_A, runId)).toBe('awaiting_approval');
    expect(await slackAudit(ORG_A, 'slack.approval_denied')).toHaveLength(1);
    // The acting step never ran.
    const steps = await withTenant(ORG_A, (tx) => tx.skillStep.findMany({ where: { runId } }));
    expect(steps.some((s) => s.name === 'verbucht')).toBe(false);
  });

  it('a linked LEAD approves — run completes, decision + "via slack" audited', async () => {
    await seedPolicy();
    const runId = await startGuardedRun();

    const res = await handleSlackInteractions(
      interactionRequest(TEAM_A, LEAD.slackId, 'ergane_approve', runId),
    );
    const body = (await res.json()) as { response_type: string; text: string };
    expect(body.response_type).toBe('in_channel');
    expect(await runStatus(ORG_A, runId)).toBe('completed');

    // Engine audit: the human decision carries the MAPPED user id...
    const decided = await slackAudit(ORG_A, 'approval.approved');
    expect(decided).toHaveLength(1);
    expect(decided[0]!.actorId).toBe(LEAD.userId);
    // ...and the adapter audit marks the Slack origin.
    const viaSlack = await slackAudit(ORG_A, 'slack.approval_approved');
    expect(viaSlack).toHaveLength(1);
    expect((viaSlack[0]!.detail as { via?: string }).via).toBe('slack');
    // The outcome was posted back into the thread (not ephemeral).
    const threadMsg = posted.find((m) => !m.ephemeralUserId && m.text.includes(runId));
    expect(threadMsg?.thread_ts).toBe('111.222');
  });

  it('a linked LEAD can reject — run ends rejected, acting step never ran', async () => {
    await seedPolicy();
    const runId = await startGuardedRun();

    await handleSlackInteractions(interactionRequest(TEAM_A, LEAD.slackId, 'ergane_reject', runId));
    expect(await runStatus(ORG_A, runId)).toBe('rejected');
    const steps = await withTenant(ORG_A, (tx) => tx.skillStep.findMany({ where: { runId } }));
    expect(steps.some((s) => s.name === 'verbucht')).toBe(false);
    expect(await slackAudit(ORG_A, 'slack.approval_rejected')).toHaveLength(1);
  });

  it('a button click from team A can not decide a run of org B (cross-tenant)', async () => {
    // A guarded run in ORG_B (started directly through the engine).
    const { startRun } = await import('../src/lib/skills');
    const handle = await startRun(ORG_B, 'beleg_kontieren', {
      beschreibung: 'Fremder Run',
      betragEur: 5000,
    });
    expect(handle.status).toBe('awaiting_approval');

    // Team A (→ org A) clicking approve on B's runId: RLS makes the run
    // invisible ⇒ engine throws "not found" ⇒ ephemeral error, B untouched.
    const res = await handleSlackInteractions(
      interactionRequest(TEAM_A, LEAD.slackId, 'ergane_approve', handle.runId),
    );
    const body = (await res.json()) as { response_type: string };
    expect(body.response_type).toBe('ephemeral');
    expect(await runStatus(ORG_B, handle.runId)).toBe('awaiting_approval');
  });
});

// --- 6. RLS regression -----------------------------------------------------------

describe('RLS regression for the new slack tables', () => {
  it('RLS is ENABLEd AND FORCEd on slack_installations and slack_user_links', async () => {
    const rows = await admin.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ANY(${NEW_TABLES}) AND relkind = 'r'`;
    expect(rows).toHaveLength(NEW_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS ENABLEd`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} must have RLS FORCEd`).toBe(true);
    }
  });

  it('without a tenant context both tables return 0 rows (lookup GUC unset)', async () => {
    expect(await prisma.slackInstallation.findMany()).toHaveLength(0);
    expect(await prisma.slackUserLink.findMany()).toHaveLength(0);
  });

  it('tenant B cannot see A’s installation or links', async () => {
    const fromB = await withTenant(ORG_B, async (tx) => ({
      installations: await tx.slackInstallation.findMany(),
      links: await tx.slackUserLink.findMany(),
    }));
    expect(fromB.installations).toHaveLength(0);
    expect(fromB.links).toHaveLength(0);
  });

  it('the global unique on slack_team_id prevents mapping one team to TWO orgs', async () => {
    await expect(
      withTenant(ORG_B, (tx) =>
        tx.slackInstallation.create({ data: { orgId: ORG_B, slackTeamId: TEAM_A } }),
      ),
    ).rejects.toThrow();
  });

  it('a link cannot reference a foreign tenant’s membership (composite FK)', async () => {
    await expect(
      withTenant(ORG_B, (tx) =>
        tx.slackUserLink.create({
          data: { orgId: ORG_B, slackUserId: 'U_SMUGGLED', userId: LEAD.userId },
        }),
      ),
    ).rejects.toThrow();
  });
});
