// P2-B: cross-signals metrics + code criteria
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { ingestDocument } from '../src/lib/rag/ingest';
import { computeLoopMetrics } from '../src/lib/loop/metrics';
import { codeCriteria } from '../src/lib/loop/criteria/code';
import { runLoopTickForOrg } from '../src/lib/loop/tick';
import type { Observation } from '../src/lib/loop/sources/types';

const ORG = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const embedder = new FakeEmbeddingProvider();
const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'org_settings',
  'documents',
  'chunks',
  'skill_runs',
  'skill_steps',
  'approvals',
  'clients',
  'chat_messages',
  'chat_feedback',
  'loop_flags',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
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
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_xs', name: 'XS Org' },
    });
  });
});

describe('code criteria', () => {
  it('fails without ticket ref', () => {
    const obs: Observation = {
      sourceKey: 'tool_artifact',
      externalRef: 'github:commit:x',
      type: 'code',
      content: 'random commit message',
      metadata: { hasTicketRef: false, message: 'random commit message' },
      createdAt: new Date(),
    };
    const r = codeCriteria.criteria[0]!.check(obs);
    expect(r.passed).toBe(false);
  });

  it('passes with ticket ref in meta', () => {
    const obs: Observation = {
      sourceKey: 'tool_artifact',
      externalRef: 'github:commit:y',
      type: 'code',
      content: 'ENG-1 done',
      metadata: { hasTicketRef: true, ticketRefs: ['ENG-1'] },
      createdAt: new Date(),
    };
    expect(codeCriteria.criteria[0]!.check(obs).passed).toBe(true);
  });
});

describe('computeLoopMetrics cross-signals', () => {
  it('does not false-alarm on empty org', async () => {
    const since = new Date(Date.now() - 7 * 86400000);
    const { metrics } = await withTenant(ORG, (tx) => computeLoopMetrics(tx, ORG, { since }));
    const c = metrics.find((m) => m.key === 'commits_without_ticket');
    const t = metrics.find((m) => m.key === 'tickets_done_without_commit');
    expect(c?.value).toBeNull();
    expect(c?.passed).toBe(true);
    expect(t?.value).toBeNull();
    expect(t?.passed).toBe(true);
  });

  it('flags high share of commits without ticket (needs min samples)', async () => {
    // MIN_METRIC_SAMPLES = 3 — seed three code docs, two missing ticket refs.
    for (const [i, meta] of [
      ['1', { hasTicketRef: false, message: 'no ticket here' }],
      ['2', { hasTicketRef: false, message: 'also bare' }],
      ['3', { hasTicketRef: true, ticketRefs: ['ENG-1'], message: 'ENG-1: linked' }],
    ] as const) {
      await ingestDocument({
        orgId: ORG,
        actorId: 'connector:github',
        title: `c${i}`,
        source: 'code',
        text: `commit body text ${i} with enough characters`,
        externalRef: `github:commit:${i}`,
        sourceMeta: meta,
        embedder,
      });
    }
    const since = new Date(Date.now() - 7 * 86400000);
    const { metrics } = await withTenant(ORG, (tx) =>
      computeLoopMetrics(tx, ORG, {
        since,
        thresholdOverrides: { commits_without_ticket: { threshold: 0.5 } },
      }),
    );
    const c = metrics.find((m) => m.key === 'commits_without_ticket');
    expect(c?.value).toBeCloseTo(2 / 3, 5);
    expect(c?.passed).toBe(false);
  });

  it('detects done tickets without commit link (min samples)', async () => {
    for (let i = 1; i <= 3; i++) {
      await ingestDocument({
        orgId: ORG,
        actorId: 'connector:linear',
        title: `ENG-7${i}: done work`,
        source: 'ticket',
        text: 'Acceptance Criteria: done item body',
        externalRef: `linear:issue:7${i}`,
        sourceMeta: { state: 'completed', identifier: `ENG-7${i}` },
        embedder,
      });
    }
    const since = new Date(Date.now() - 7 * 86400000);
    const { metrics } = await withTenant(ORG, (tx) =>
      computeLoopMetrics(tx, ORG, {
        since,
        thresholdOverrides: { tickets_done_without_commit: { threshold: 0.1 } },
      }),
    );
    const t = metrics.find((m) => m.key === 'tickets_done_without_commit');
    expect(t?.value).toBe(1);
    expect(t?.passed).toBe(false);
  });
});

describe('tick raises code criteria flags + loop_flags row', () => {
  it('creates loop_flag for commit without ticket', async () => {
    await ingestDocument({
      orgId: ORG,
      actorId: 'connector:github',
      title: 'orphan commit',
      source: 'code',
      text: 'just a message with no tracker reference at all',
      externalRef: 'github:commit:orphan',
      sourceMeta: {
        hasTicketRef: false,
        message: 'just a message with no tracker reference at all',
        text: 'just a message with no tracker reference at all',
      },
      embedder,
    });
    const n = await runLoopTickForOrg(ORG, new Date(Date.now() - 7 * 86400000));
    expect(n).toBeGreaterThanOrEqual(1);
    const flags = await withTenant(ORG, (tx) => tx.loopFlag.findMany());
    expect(flags.some((f) => f.target === 'github:commit:orphan')).toBe(true);
    expect(flags.every((f) => f.status === 'open')).toBe(true);
  });
});
