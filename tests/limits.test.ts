// =============================================================================
// NUTZUNGSLIMIT GATE (Kostenschutz)
//
//   1. effectiveLimit: Default, Env-Override, <= 0 ⇒ abgeschaltet.
//   2. Chat: Limit erreicht ⇒ deutsche Fehlermeldung VOR dem (bezahlten)
//      Provider-Aufruf; anderer Tenant bleibt unberührt (RLS-scoped count).
//   3. Ingest & Skill-Runs: gleiche Semantik.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { effectiveLimit } from '../src/lib/limits';
import { answerQuestion, ingestDocument } from '../src/lib/rag';
import { startRun } from '../src/lib/skills';

const ORG_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const ORG_B = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies',
];

const LIMIT_ENVS = ['LIMIT_CHAT_PER_DAY', 'LIMIT_INGEST_PER_DAY', 'LIMIT_RUNS_PER_DAY'];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
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
    [ORG_A, 'org_lim_a', 'Limit A'],
    [ORG_B, 'org_lim_b', 'Limit B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
    });
  }
});

afterEach(() => {
  for (const key of LIMIT_ENVS) delete process.env[key];
});

describe('effectiveLimit', () => {
  it('default, env override, and <= 0 disables', () => {
    expect(effectiveLimit('chat')).toBe(200);
    process.env.LIMIT_CHAT_PER_DAY = '5';
    expect(effectiveLimit('chat')).toBe(5);
    process.env.LIMIT_CHAT_PER_DAY = '0';
    expect(effectiveLimit('chat')).toBeNull();
    process.env.LIMIT_CHAT_PER_DAY = '';
    expect(effectiveLimit('chat')).toBe(200);
  });
});

describe('chat limit', () => {
  it('blocks the next question once todays user messages reach the limit — per tenant', async () => {
    process.env.LIMIT_CHAT_PER_DAY = '2';
    await withTenant(ORG_A, async (tx) => {
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'f1', actorId: 'u' } });
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'f2', actorId: 'u' } });
    });

    await expect(
      answerQuestion({ orgId: ORG_A, actorId: 'u', question: 'Noch eine?' }),
    ).rejects.toThrow(/Tageslimit erreicht: 2 Chat-Anfragen/);

    // Fremder Tenant zählt eigene Nutzung — bleibt frei.
    const other = await answerQuestion({ orgId: ORG_B, actorId: 'u', question: 'Geht das?' });
    expect(other.answer.length).toBeGreaterThan(0);
  });
});

describe('ingest limit', () => {
  it('blocks the next document once the daily count is reached', async () => {
    process.env.LIMIT_INGEST_PER_DAY = '1';
    await ingestDocument({ orgId: ORG_A, actorId: 'u', title: 'Doku 1', text: 'Inhalt eins.', source: 'manual' });
    await expect(
      ingestDocument({ orgId: ORG_A, actorId: 'u', title: 'Doku 2', text: 'Inhalt zwei.', source: 'manual' }),
    ).rejects.toThrow(/Tageslimit erreicht: 1 neue Dokumente/);
  });
});

describe('run limit', () => {
  it('blocks the next skill run once the daily count is reached', async () => {
    process.env.LIMIT_RUNS_PER_DAY = '1';
    const first = await startRun(ORG_A, 'angebot_erstellen', {
      kunde: 'K', leistung: 'L', betragEur: 10,
    });
    expect(first.status).toBe('awaiting_approval');

    await expect(
      startRun(ORG_A, 'angebot_erstellen', { kunde: 'K', leistung: 'L', betragEur: 10 }),
    ).rejects.toThrow(/Tageslimit erreicht: 1 Skill-Läufe/);
  });
});
