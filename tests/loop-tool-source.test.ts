// =============================================================================
// LOOP F — ToolArtifactSource + ticket criteria + tick integration
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { ingestDocument } from '../src/lib/rag/ingest';
import { ticketCriteria, STALE_DAYS, GRACE_DAYS } from '../src/lib/loop/criteria/ticket';
import { toolArtifactSource, getPeriodicObservationSources } from '../src/lib/loop/sources';
import type { Observation } from '../src/lib/loop/sources/types';
import { runLoopTickForOrg, evaluateToolObservations } from '../src/lib/loop/tick';
import { computeLoopMetrics } from '../src/lib/loop/metrics';

const ORG = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const ADMIN = 'loop_tool_admin';
const embedder = new FakeEmbeddingProvider();

const ALL_TABLES = [
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
];

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
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_loop_tool', name: 'Loop Tool Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
  });
});

function ticketObs(meta: Record<string, unknown>, content = 'Ticket body'): Observation {
  return {
    sourceKey: 'tool_artifact',
    externalRef: 'linear:issue:t1',
    type: 'ticket',
    content,
    metadata: meta,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
  };
}

const check = (key: string, obs: Observation) => {
  const c = ticketCriteria.criteria.find((x) => x.key === key);
  if (!c) throw new Error(key);
  return c.check(obs);
};

describe('ticket criteria (pure)', () => {
  const now = new Date('2024-06-15T12:00:00.000Z');

  it('ticket_overdue fails when open and past due', () => {
    const r = check(
      'ticket_overdue',
      ticketObs({
        state: 'started',
        dueDate: '2024-01-01',
        now: now.toISOString(),
      }),
    );
    expect(r.passed).toBe(false);
  });

  it('ticket_overdue passes when dueDate missing', () => {
    const r = check('ticket_overdue', ticketObs({ state: 'started', now: now.toISOString() }));
    expect(r.passed).toBe(true);
  });

  it('ticket_stale fails after STALE_DAYS without activity', () => {
    const last = new Date(now.getTime() - (STALE_DAYS + 2) * 86400000);
    const r = check(
      'ticket_stale',
      ticketObs({
        state: 'started',
        lastActivityAt: last.toISOString(),
        now: now.toISOString(),
      }),
    );
    expect(r.passed).toBe(false);
  });

  it('ticket_unassigned fails after grace without assignee', () => {
    const created = new Date(now.getTime() - (GRACE_DAYS + 3) * 86400000);
    const r = check(
      'ticket_unassigned',
      ticketObs({
        state: 'started',
        assigneeId: null,
        createdAt: created.toISOString(),
        now: now.toISOString(),
      }),
    );
    expect(r.passed).toBe(false);
  });

  it('ticket_missing_acceptance fails without markers', () => {
    const r = check(
      'ticket_missing_acceptance',
      ticketObs({ state: 'started' }, 'Just a vague ticket description'),
    );
    expect(r.passed).toBe(false);
  });

  it('ticket_missing_acceptance passes with AC marker', () => {
    const r = check(
      'ticket_missing_acceptance',
      ticketObs({ state: 'started' }, 'Acceptance Criteria:\n- done'),
    );
    expect(r.passed).toBe(true);
  });
});

describe('toolArtifactSource + tick', () => {
  it('getPeriodicObservationSources excludes deliverable', () => {
    const keys = getPeriodicObservationSources().map((s) => s.key);
    expect(keys).toContain('tool_artifact');
    expect(keys).not.toContain('deliverable');
  });

  it('fetchObservations returns ticket docs with external_ref', async () => {
    await ingestDocument({
      orgId: ORG,
      actorId: 'connector:linear',
      title: 'ENG-1: Overdue work',
      source: 'ticket',
      text: 'No markers here just work',
      externalRef: 'linear:issue:overdue-1',
      sourceMeta: {
        state: 'started',
        dueDate: '2020-01-01',
        assigneeId: null,
        lastActivityAt: '2020-01-01T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
        text: 'No markers here just work',
      },
      embedder,
    });

    const since = new Date(Date.now() - 7 * 86400000);
    const obs = await toolArtifactSource.fetchObservations(ORG, since);
    expect(obs.length).toBe(1);
    expect(obs[0].type).toBe('ticket');
    expect(obs[0].externalRef).toBe('linear:issue:overdue-1');
  });

  it('runLoopTickForOrg raises criteria flag for overdue ticket', async () => {
    await ingestDocument({
      orgId: ORG,
      actorId: 'connector:linear',
      title: 'ENG-2: Bad ticket',
      source: 'ticket',
      text: 'Vague ticket without any structure',
      externalRef: 'linear:issue:bad-1',
      sourceMeta: {
        state: 'started',
        dueDate: '2020-01-01',
        assigneeId: null,
        sprintId: null,
        lastActivityAt: '2020-01-01T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
        text: 'Vague ticket without any structure',
      },
      embedder,
    });

    const since = new Date(Date.now() - 7 * 86400000);
    const n = await runLoopTickForOrg(ORG, since);
    expect(n).toBeGreaterThanOrEqual(1);

    const flags = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: 'flag.criteria_violated' } }),
    );
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags[0].target).toBe('linear:issue:bad-1');
    const detail = flags[0].detail as { failedCriteria?: unknown[]; correction?: unknown };
    expect(Array.isArray(detail.failedCriteria)).toBe(true);
    expect(detail.correction).toBeUndefined();
  });

  it('dedups tool criteria flags within window', async () => {
    await ingestDocument({
      orgId: ORG,
      actorId: 'connector:linear',
      title: 'ENG-3: Dedupe',
      source: 'ticket',
      text: 'Vague',
      externalRef: 'linear:issue:dedupe-1',
      sourceMeta: {
        state: 'started',
        dueDate: '2020-01-01',
        assigneeId: null,
        lastActivityAt: '2020-01-01T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
        text: 'Vague',
      },
      embedder,
    });
    const since = new Date(Date.now() - 7 * 86400000);
    const first = await runLoopTickForOrg(ORG, since);
    const second = await runLoopTickForOrg(ORG, since);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });

  it('evaluateToolObservations finds failures outside tx', async () => {
    await ingestDocument({
      orgId: ORG,
      actorId: 'connector:linear',
      title: 'ENG-4',
      source: 'ticket',
      text: 'x',
      externalRef: 'linear:issue:eval-1',
      sourceMeta: {
        state: 'started',
        dueDate: '2020-01-01',
        text: 'x',
        createdAt: '2020-01-01T00:00:00.000Z',
        lastActivityAt: '2020-01-01T00:00:00.000Z',
      },
      embedder,
    });
    const pending = await evaluateToolObservations(ORG, new Date(Date.now() - 7 * 86400000), {
      suggest: false,
      locale: 'en',
    });
    expect(pending.length).toBe(1);
    expect(pending[0].failed.length).toBeGreaterThan(0);
  });

  it('computeLoopMetrics includes tool metrics without false alarm on empty', async () => {
    const since = new Date(Date.now() - 7 * 86400000);
    const { metrics } = await withTenant(ORG, (tx) => computeLoopMetrics(tx, ORG, { since }));
    const keys = metrics.map((m) => m.key);
    expect(keys).toContain('open_tickets_without_acceptance');
    expect(keys).toContain('stale_open_tickets');
    const empty = metrics.find((m) => m.key === 'open_tickets_without_acceptance');
    expect(empty?.passed).toBe(true);
    expect(empty?.value).toBeNull();
  });
});
