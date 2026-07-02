// =============================================================================
// FEEDBACK GATE (Phase 18)
//
//   1. submitChatFeedback: only ASSISTANT answers of the voter's OWN
//      conversation (fail-closed — foreign/legacy messages rejected); votes
//      are changeable (upsert), one per (message, voter).
//   2. getFeedbackStats / getOwnFeedback: tenant-bound aggregates.
//   3. RLS regression on chat_feedback + composite-FK cross-tenant guard.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { getFeedbackStats, getOwnFeedback, submitChatFeedback } from '../src/lib/rag';

const ORG_A = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const ORG_B = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const ALICE = 'fb_alice';
const BOB = 'fb_bob';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'chat_messages', 'chat_feedback',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Persist one assistant answer for `actorId`, returns the message id. */
async function assistantMessage(orgId: string, actorId: string | null, content = 'Antwort.') {
  return withTenant(orgId, async (tx) => {
    const row = await tx.chatMessage.create({
      data: { orgId, role: 'assistant', content, actorId },
    });
    return row.id;
  });
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_fb_a', 'Feedback A'],
    [ORG_B, 'org_fb_b', 'Feedback B'],
  ] as const) {
    await withTenant(orgId, (tx) =>
      tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } }),
    );
  }
});

describe('submitChatFeedback (fail-closed voting rule)', () => {
  it('accepts a vote on the OWN assistant answer; the vote is changeable', async () => {
    const msgId = await assistantMessage(ORG_A, ALICE);

    await submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: msgId, verdict: 'up' });
    expect(await getFeedbackStats(ORG_A)).toEqual({ up: 1, down: 0 });

    // Changing the mind upserts — never a second row.
    await submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: msgId, verdict: 'down' });
    expect(await getFeedbackStats(ORG_A)).toEqual({ up: 0, down: 1 });

    const own = await getOwnFeedback(ORG_A, ALICE, [msgId]);
    expect(own[msgId]).toBe('down');
  });

  it('rejects votes on foreign conversations, user messages and legacy rows', async () => {
    const foreign = await assistantMessage(ORG_A, BOB);
    await expect(
      submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: foreign, verdict: 'up' }),
    ).rejects.toThrow(/own conversation/);

    const legacy = await assistantMessage(ORG_A, null); // pre-0010 shape
    await expect(
      submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: legacy, verdict: 'up' }),
    ).rejects.toThrow(/own conversation/);

    const userMsg = await withTenant(ORG_A, async (tx) => {
      const row = await tx.chatMessage.create({
        data: { orgId: ORG_A, role: 'user', content: 'Frage?', actorId: ALICE },
      });
      return row.id;
    });
    await expect(
      submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: userMsg, verdict: 'up' }),
    ).rejects.toThrow(/assistant/);
  });

  it('is tenant-bound: a message id of org B is "not found" from org A', async () => {
    const bMsg = await assistantMessage(ORG_B, ALICE);
    await expect(
      submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: bMsg, verdict: 'up' }),
    ).rejects.toThrow();
    expect(await getFeedbackStats(ORG_B)).toEqual({ up: 0, down: 0 });
  });
});

describe('chat_feedback RLS + structure regression', () => {
  it('RLS is ENABLEd AND FORCEd; no-context sees 0 rows', async () => {
    const [row] = await admin.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'chat_feedback' AND relkind = 'r'`;
    expect(row!.relrowsecurity).toBe(true);
    expect(row!.relforcerowsecurity).toBe(true);

    const msgId = await assistantMessage(ORG_A, ALICE);
    await submitChatFeedback({ orgId: ORG_A, actorId: ALICE, messageId: msgId, verdict: 'up' });
    expect(await prisma.chatFeedback.findMany()).toHaveLength(0); // no context
  });

  it('the composite FK rejects a vote row referencing another tenant’s message', async () => {
    const bMsg = await assistantMessage(ORG_B, ALICE);
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.chatFeedback.create({
          data: { orgId: ORG_A, messageId: bMsg, actorId: ALICE, verdict: 'up' },
        }),
      ),
    ).rejects.toThrow();
  });
});
