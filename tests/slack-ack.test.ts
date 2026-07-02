// =============================================================================
// SLACK ACK-THEN-WORK + IDEMPOTENCY GATE (Phase 6b)
//
// Slack requires a 200 within 3 seconds, otherwise it redelivers (up to 3×).
// This suite proves the fix on the REAL handlers:
//
//   1. Order: the 200 is returned BEFORE any work ran (poster untouched, no
//      chat messages) — the answer arrives in the deferred phase.
//   2. The security gates still come FIRST: invalid signature ⇒ 401, unmapped
//      team ⇒ 403 — never a premature 200, and nothing is claimed or deferred.
//   3. Idempotency: the same event_id / trigger_id delivered twice executes
//      the work exactly ONCE (second delivery: 200, no effect) — and claims
//      are per tenant: the same key in org A and org B don't collide.
//   4. deferWork: a failing task is logged + reported to the Slack user, never
//      an unhandled rejection; the HTTP response was 200 regardless.
//   5. url_verification stays synchronous (challenge in the response body).
//
// Runs as `app_user` (DATABASE_URL); owner connection only resets. No network.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { ingestDocument } from '../src/lib/rag';
import { computeSlackSignature } from '../src/lib/slack/verify';
import { handleSlackCommands, handleSlackEvents } from '../src/lib/slack/handlers';
import { setSlackPoster, type SlackOutgoingMessage } from '../src/lib/slack/client';
import { deferWork, drainDeferredWork } from '../src/lib/slack/defer';
import { claimSlackEvent, cleanupProcessedSlackEvents } from '../src/lib/slack/idempotency';

const ORG_A = '99999999-9999-4999-8999-999999999999';
const ORG_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_A = 'T_ACK_ORG_A';
const TEAM_B = 'T_ACK_ORG_B';
const SECRET = 'slack-ack-test-signing-secret';
const LEAD = { userId: 'alice_lead', role: 'lead' as const, slackId: 'U_LEAD' };

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let posted: SlackOutgoingMessage[] = [];

function signedRequest(body: string, contentType: string): Request {
  const timestamp = Math.floor(Date.now() / 1000);
  return new Request('http://localhost/api/slack/test', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': computeSlackSignature(SECRET, timestamp, body),
    },
    body,
  });
}

/** An events request with an EXPLICIT event_id — retries of the same delivery
 * carry the same event_id, which is exactly what the idempotency claim keys on. */
function mentionEvent(teamId: string, eventId: string, text: string): Request {
  return signedRequest(
    JSON.stringify({
      type: 'event_callback',
      team_id: teamId,
      event_id: eventId,
      event: { type: 'app_mention', user: LEAD.slackId, text, channel: 'C_ACK', ts: '111.222' },
    }),
    'application/json',
  );
}

function commandRequest(teamId: string, triggerId: string, text: string): Request {
  const body = new URLSearchParams({
    command: '/ergane',
    team_id: teamId,
    user_id: LEAD.slackId,
    channel_id: 'C_ACK',
    trigger_id: triggerId,
    text,
  }).toString();
  return signedRequest(body, 'application/x-www-form-urlencoded');
}

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_ack_a', name: 'Ack Org A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: LEAD.userId, role: LEAD.role } });
    await tx.slackInstallation.create({ data: { orgId: ORG_A, slackTeamId: TEAM_A } });
    await tx.slackUserLink.create({
      data: { orgId: ORG_A, slackUserId: LEAD.slackId, userId: LEAD.userId },
    });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_ack_b', name: 'Ack Org B' } });
    await tx.slackInstallation.create({ data: { orgId: ORG_B, slackTeamId: TEAM_B } });
  });
  await ingestDocument({
    orgId: ORG_A,
    actorId: 'seed',
    title: 'Urlaubsrichtlinie',
    source: 'manual',
    text: 'Alle Mitarbeitenden haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
  });
  await ingestDocument({
    orgId: ORG_B,
    actorId: 'seed',
    title: 'Urlaubsrichtlinie B',
    source: 'manual',
    text: 'In dieser Organisation gibt es 28 Urlaubstage pro Kalenderjahr.',
  });
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
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
  await drainDeferredWork();
  posted = [];
  setSlackPoster(async (msg) => {
    posted.push(msg);
  });
  await reset();
  await seed();
});

async function claimCount(orgId: string): Promise<number> {
  return withTenant(orgId, (tx) => tx.slackProcessedEvent.count());
}

// --- 1. ack before work -----------------------------------------------------------

describe('ack-then-work: the 200 comes first, the work afterwards', () => {
  it('events: 200 returned while NOTHING was posted or persisted yet', async () => {
    const res = await handleSlackEvents(mentionEvent(TEAM_A, 'Ev_order_1', 'Wie viele Urlaubstage?'));
    expect(res.status).toBe(200);

    // At ack time: no outgoing message, no chat history — the work has not run.
    expect(posted).toHaveLength(0);
    expect(await withTenant(ORG_A, (tx) => tx.chatMessage.count())).toBe(0);
    // But the delivery IS already claimed (idempotency happens before the ack).
    expect(await claimCount(ORG_A)).toBe(1);

    await drainDeferredWork();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toContain('30 Urlaubstage');
    expect(await withTenant(ORG_A, (tx) => tx.chatMessage.count())).toBe(2);
  });

  it('commands: immediate ephemeral "wird bearbeitet", answer follows via poster', async () => {
    const res = await handleSlackCommands(commandRequest(TEAM_A, 'trig_order_1', 'frage Wie viele Urlaubstage?'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { response_type: string; text: string };
    expect(body.response_type).toBe('ephemeral');
    expect(body.text).toContain('bearbeitet');
    expect(posted).toHaveLength(0);

    await drainDeferredWork();
    const answer = posted.find((m) => !m.ephemeralUserId);
    expect(answer?.channel).toBe('C_ACK');
    expect(answer?.text).toContain('30 Urlaubstage');
  });

  it('url_verification stays synchronous — challenge in the response body, nothing deferred', async () => {
    const res = await handleSlackEvents(
      signedRequest(JSON.stringify({ type: 'url_verification', challenge: 'chlg_ack' }), 'application/json'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'chlg_ack' });
    await drainDeferredWork();
    expect(posted).toHaveLength(0);
  });
});

// --- 2. gates before ack -----------------------------------------------------------

describe('the security gates still precede the ack', () => {
  it('invalid signature ⇒ 401 — nothing claimed, nothing deferred', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: TEAM_A,
      event_id: 'Ev_gate_1',
      event: { type: 'app_mention', user: LEAD.slackId, text: 'x', channel: 'C', ts: '1.2' },
    });
    const res = await handleSlackEvents(
      new Request('http://localhost/api/slack/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
    await drainDeferredWork();
    expect(posted).toHaveLength(0);
    expect(await claimCount(ORG_A)).toBe(0);
  });

  it('unmapped team ⇒ 403 — nothing claimed, nothing deferred', async () => {
    const res = await handleSlackEvents(mentionEvent('T_NOWHERE', 'Ev_gate_2', 'x'));
    expect(res.status).toBe(403);
    await drainDeferredWork();
    expect(posted).toHaveLength(0);
    expect(await claimCount(ORG_A)).toBe(0);
  });
});

// --- 3. idempotency ---------------------------------------------------------------

describe('idempotency: duplicate deliveries execute the work exactly once', () => {
  it('events: the same event_id twice ⇒ one answer, second delivery acks silently', async () => {
    const first = await handleSlackEvents(mentionEvent(TEAM_A, 'Ev_dup_1', 'Wie viele Urlaubstage?'));
    const second = await handleSlackEvents(mentionEvent(TEAM_A, 'Ev_dup_1', 'Wie viele Urlaubstage?'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    await drainDeferredWork();
    expect(posted).toHaveLength(1); // ONE answer despite two deliveries
    expect(await withTenant(ORG_A, (tx) => tx.chatMessage.count())).toBe(2); // one Q/A pair
    expect(await claimCount(ORG_A)).toBe(1);
  });

  it('commands: the same trigger_id twice ⇒ startRun executes once', async () => {
    const text = 'skill wissen_zusammenfassen {"frage":"Urlaubstage?"}';
    await handleSlackCommands(commandRequest(TEAM_A, 'trig_dup_1', text));
    const second = await handleSlackCommands(commandRequest(TEAM_A, 'trig_dup_1', text));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { text: string };
    expect(secondBody.text).toContain('bereits verarbeitet');

    await drainDeferredWork();
    expect(await withTenant(ORG_A, (tx) => tx.skillRun.count())).toBe(1);
  });

  it('claims are per tenant: the same key in org A and org B do not collide', async () => {
    // Direct claim check …
    expect(await claimSlackEvent(ORG_A, 'shared-key')).toBe(true);
    expect(await claimSlackEvent(ORG_B, 'shared-key')).toBe(true); // other tenant: fresh
    expect(await claimSlackEvent(ORG_A, 'shared-key')).toBe(false); // same tenant: duplicate

    // … and end-to-end: the same event_id via team A and team B answers BOTH,
    // each from its own tenant's knowledge.
    await handleSlackEvents(mentionEvent(TEAM_A, 'Ev_shared', 'Wie viele Urlaubstage?'));
    await handleSlackEvents(mentionEvent(TEAM_B, 'Ev_shared', 'Wie viele Urlaubstage?'));
    await drainDeferredWork();
    const texts = posted.map((m) => m.text).join('\n');
    expect(texts).toContain('30 Urlaubstage'); // org A's document
    expect(texts).toContain('28 Urlaubstage'); // org B's document
  });

  it('cleanupProcessedSlackEvents removes only entries older than the horizon', async () => {
    await claimSlackEvent(ORG_A, 'old-key');
    await claimSlackEvent(ORG_A, 'fresh-key');
    // Age one claim beyond 24 h (owner connection — created_at has no app grant).
    await admin.$executeRaw`UPDATE "slack_processed_events"
      SET "created_at" = now() - interval '25 hours' WHERE "event_key" = 'old-key'`;

    const removed = await cleanupProcessedSlackEvents(ORG_A);
    expect(removed).toBe(1);
    expect(await claimCount(ORG_A)).toBe(1);
    expect(await claimSlackEvent(ORG_A, 'fresh-key')).toBe(false); // still claimed
  });
});

// --- 4. deferWork failure handling ---------------------------------------------------

describe('deferWork: failures are contained, logged, and reported to the user', () => {
  it('a throwing task triggers onFailure and never an unhandled rejection', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFailure = vi.fn(async () => {});

    deferWork(
      async () => {
        throw new Error('boom');
      },
      { label: 'test:boom', onFailure },
    );
    await drainDeferredWork();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('even a failing onFailure is only logged, never rethrown', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    deferWork(
      async () => {
        throw new Error('boom');
      },
      {
        onFailure: async () => {
          throw new Error('notify also boomed');
        },
      },
    );
    await drainDeferredWork();
    expect(errorLog).toHaveBeenCalledTimes(2); // task failure + notify failure
    errorLog.mockRestore();
  });

  it('end-to-end: when delivering the answer fails, the user gets a Slack error message — the HTTP response was still 200', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The poster rejects the ANSWER post (contains the sources line) but lets
    // the failure notification through.
    setSlackPoster(async (msg) => {
      if (msg.text.includes('Quellen:')) throw new Error('slack api down');
      posted.push(msg);
    });

    const res = await handleSlackEvents(mentionEvent(TEAM_A, 'Ev_fail_1', 'Wie viele Urlaubstage?'));
    expect(res.status).toBe(200);

    await drainDeferredWork();
    const failureNote = posted.find((m) => m.ephemeralUserId === LEAD.slackId);
    expect(failureNote?.text).toContain('fehlgeschlagen');
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
