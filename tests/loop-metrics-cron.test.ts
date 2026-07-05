// =============================================================================
// LOOP TICK — periodic process-metric check (Schritt C)
//
// This gate pins the trend-driven flag trigger:
//
//   1. computeLoopMetrics(): the 4 metrics compute correct values against their
//      thresholds, inside one withTenant tx (fast DB reads only). No data → the
//      metric passes (never a false alarm on an empty org).
//   2. buildMetricFlag() → toFlagView(): the metric-flag detail shape is exactly
//      what the Schritt-B projection reads, so it renders in cockpit + /flags.
//   3. Cron route: fail-closed — no CRON_SECRET → 503, wrong bearer → 401,
//      correct bearer + a metric under threshold → flag.metric_deviation in the
//      audit trail; body carries only counters.
//   4. Dedup: a second tick within 24h raises NO duplicate metric flag.
//   5. Isolation: each org runs in its own tx; one tenant's failure is counted
//      and skipped, the others still get checked.
//
// Same harness as value-dashboard.test.ts: runs as `app_user`, owner connection
// only to reset state between cases.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type SkillRunStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { logAudit } from '../src/lib/audit';
import { computeLoopMetrics, type LoopMetricKey } from '../src/lib/loop/metrics';
import { buildMetricFlag } from '../src/lib/loop/metric-flags';
import { runLoopTick, runLoopTickForOrg } from '../src/lib/loop/tick';
import { toFlagView } from '../src/lib/loop/flags-view';
import { GET as cronGet } from '../src/app/api/cron/loop/route';

const ORG_A = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const ORG_B = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const ADMIN = 'loop_admin';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings',
  'skill_runs', 'skill_steps', 'approvals', 'clients',
  'chat_messages', 'chat_feedback',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrgs() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_loop_a', 'Loop A'],
    [ORG_B, 'org_loop_b', 'Loop B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
    });
  }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Seed a live skill run (optionally client-attributed) for one org. */
async function seedRun(
  orgId: string,
  skillKey: string,
  status: SkillRunStatus,
  clientId: string | null = null,
  createdAt: Date = daysAgo(1),
) {
  await withTenant(orgId, (tx) =>
    tx.skillRun.create({
      data: { orgId, skillKey, status, mode: 'live', input: {}, clientId, createdAt },
    }),
  );
}

async function seedClient(orgId: string, id: string, name: string) {
  await withTenant(orgId, (tx) => tx.client.create({ data: { id, orgId, name } }));
}

/** Seed an approval decision as an audit row (that is what the metric reads). */
async function seedApprovalDecision(orgId: string, approved: boolean, createdAt = daysAgo(1)) {
  await withTenant(orgId, (tx) =>
    tx.auditLog.create({
      data: {
        orgId,
        actorId: ADMIN,
        actorType: 'human',
        action: approved ? 'approval.approved' : 'approval.rejected',
        createdAt,
      },
    }),
  );
}

/** Seed a chat message + a feedback vote on it. */
async function seedFeedback(orgId: string, verdict: 'up' | 'down', createdAt = daysAgo(1)) {
  await withTenant(orgId, async (tx) => {
    const msg = await tx.chatMessage.create({
      data: { orgId, role: 'assistant', content: 'answer', actorId: ADMIN },
    });
    await tx.chatFeedback.create({
      data: { orgId, messageId: msg.id, actorId: `${ADMIN}-${verdict}-${Math.random()}`, verdict, createdAt },
    });
  });
}

async function metricsFor(orgId: string): Promise<Record<LoopMetricKey, { value: number | null; passed: boolean }>> {
  const { metrics } = await withTenant(orgId, (tx) =>
    computeLoopMetrics(tx, orgId, { since: daysAgo(7) }),
  );
  const out = {} as Record<LoopMetricKey, { value: number | null; passed: boolean }>;
  for (const m of metrics) out[m.key] = { value: m.value, passed: m.passed };
  return out;
}

async function metricFlags(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx.auditLog.findMany({ where: { action: 'flag.metric_deviation' }, orderBy: { createdAt: 'desc' } }),
  );
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
  delete process.env.CRON_SECRET;
  await reset();
  await seedOrgs();
});

// ---------------------------------------------------------------------------
// 1. computeLoopMetrics
// ---------------------------------------------------------------------------
describe('computeLoopMetrics', () => {
  it('empty org: every metric has no data and passes (no false alarms)', async () => {
    const m = await metricsFor(ORG_A);
    for (const key of Object.keys(m) as LoopMetricKey[]) {
      expect(m[key].value).toBeNull();
      expect(m[key].passed).toBe(true);
    }
  });

  it('success_rate = completed / decided; fails below 0.7', async () => {
    // 1 completed, 3 failed → 0.25 < 0.7
    await seedRun(ORG_A, 'transkript_zu_framework', 'completed');
    await seedRun(ORG_A, 'transkript_zu_framework', 'failed');
    await seedRun(ORG_A, 'transkript_zu_framework', 'failed');
    await seedRun(ORG_A, 'transkript_zu_framework', 'rejected');
    const m = await metricsFor(ORG_A);
    expect(m.success_rate.value).toBeCloseTo(0.25, 5);
    expect(m.success_rate.passed).toBe(false);
  });

  it('success_rate passes at/above 0.7', async () => {
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    const m = await metricsFor(ORG_A);
    expect(m.success_rate.value).toBeCloseTo(0.75, 5);
    expect(m.success_rate.passed).toBe(true);
  });

  it('approval_rate = approved / (approved+rejected); fails below 0.6', async () => {
    await seedApprovalDecision(ORG_A, true);
    await seedApprovalDecision(ORG_A, false);
    await seedApprovalDecision(ORG_A, false); // 1/3 ≈ 0.33
    const m = await metricsFor(ORG_A);
    expect(m.approval_rate.value).toBeCloseTo(1 / 3, 5);
    expect(m.approval_rate.passed).toBe(false);
  });

  it('iteration_rate = worst runs per same client+skill; fails above 3', async () => {
    await seedClient(ORG_A, 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'ClientX');
    const cid = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
    for (let i = 0; i < 4; i++) await seedRun(ORG_A, 'transkript_zu_framework', 'completed', cid);
    const m = await metricsFor(ORG_A);
    expect(m.iteration_rate.value).toBe(4);
    expect(m.iteration_rate.passed).toBe(false);
  });

  it('iteration_rate ignores runs without a client', async () => {
    for (let i = 0; i < 5; i++) await seedRun(ORG_A, 's', 'completed', null);
    const m = await metricsFor(ORG_A);
    expect(m.iteration_rate.value).toBeNull();
    expect(m.iteration_rate.passed).toBe(true);
  });

  it('feedback_negative_rate = down / (up+down); fails above 0.15', async () => {
    await seedFeedback(ORG_A, 'down');
    await seedFeedback(ORG_A, 'up');
    await seedFeedback(ORG_A, 'up'); // 1/3 ≈ 0.33 > 0.15
    const m = await metricsFor(ORG_A);
    expect(m.feedback_negative_rate.value).toBeCloseTo(1 / 3, 5);
    expect(m.feedback_negative_rate.passed).toBe(false);
  });

  it('respects the window: rows older than `since` do not count', async () => {
    await seedRun(ORG_A, 's', 'failed', null, daysAgo(30)); // outside 7d
    const m = await metricsFor(ORG_A);
    expect(m.success_rate.value).toBeNull(); // nothing inside the window
  });

  it('is tenant-isolated: ORG_A metrics ignore ORG_B runs', async () => {
    await seedRun(ORG_B, 's', 'failed');
    await seedRun(ORG_B, 's', 'failed');
    const m = await metricsFor(ORG_A);
    expect(m.success_rate.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Metric-flag shape ↔ toFlagView (Schritt B contract)
// ---------------------------------------------------------------------------
describe('buildMetricFlag → toFlagView', () => {
  it('projects a metric flag into the shape the UI renders', async () => {
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed'); // 0.25

    const { metrics } = await withTenant(ORG_A, (tx) =>
      computeLoopMetrics(tx, ORG_A, { since: daysAgo(7) }),
    );
    const failing = metrics.find((mm) => mm.key === 'success_rate')!;
    const entry = buildMetricFlag(ORG_A, failing);

    // Write it, read it back, project it — the full round trip.
    await withTenant(ORG_A, (tx) => logAudit(tx, entry));
    const [row] = await metricFlags(ORG_A);
    const view = toFlagView(row!);

    expect(view.category).toBe('metric');
    expect(view.target).toBe('success_rate');
    expect(view.deviations).toHaveLength(1);
    expect(view.deviations[0]!.key).toBe('success_rate');
    expect(view.deviations[0]!.expected).toBe('0.7');
    expect(view.deviations[0]!.actual).toBe('0.25');
    expect(view.severity).toBe('critical'); // 0.25 misses 0.7 by > half of 0.7
  });

  it('warning severity for a small miss', async () => {
    // approval 0.5 vs 0.6 → miss 0.1 < 0.5*0.6=0.3 → warning
    await seedApprovalDecision(ORG_A, true);
    await seedApprovalDecision(ORG_A, false);
    const { metrics } = await withTenant(ORG_A, (tx) =>
      computeLoopMetrics(tx, ORG_A, { since: daysAgo(7) }),
    );
    const failing = metrics.find((mm) => mm.key === 'approval_rate')!;
    expect(failing.passed).toBe(false);

    await withTenant(ORG_A, (tx) => logAudit(tx, buildMetricFlag(ORG_A, failing)));
    const [row] = await metricFlags(ORG_A);
    expect(toFlagView(row!).severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// 3. Cron route — fail-closed + writes a flag
// ---------------------------------------------------------------------------
describe('GET /api/cron/loop', () => {
  const req = (auth?: string) =>
    new Request('http://localhost/api/cron/loop', {
      headers: auth ? { authorization: auth } : {},
    });

  it('503 without CRON_SECRET configured (fail-closed)', async () => {
    const res = await cronGet(req('Bearer whatever'));
    expect(res.status).toBe(503);
  });

  it('401 with missing or wrong bearer', async () => {
    process.env.CRON_SECRET = 'test-secret';
    expect((await cronGet(req())).status).toBe(401);
    expect((await cronGet(req('Bearer nope'))).status).toBe(401);
  });

  it('200 + writes flag.metric_deviation for a metric under threshold', async () => {
    process.env.CRON_SECRET = 'test-secret';
    // ORG_A: low success rate → should be flagged.
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed');

    const res = await cronGet(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.orgs).toBe(2); // both orgs enumerated
    expect(body.failed).toBe(0);
    expect(body.flagsRaised as number).toBeGreaterThanOrEqual(1);

    const flags = await metricFlags(ORG_A);
    expect(flags.some((f) => (f.detail as { metric?: string }).metric === 'success_rate')).toBe(true);
    // Body carries only counters — no tenant payload.
    expect(Object.keys(body).sort()).toEqual(['failed', 'flagsRaised', 'ok', 'orgs']);
  });

  it('a healthy org raises no flags', async () => {
    process.env.CRON_SECRET = 'test-secret';
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'completed');
    await cronGet(req('Bearer test-secret'));
    expect(await metricFlags(ORG_A)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Deduplication — no duplicate metric flag within 24h (matches daily cron)
// ---------------------------------------------------------------------------

/**
 * Seed a metric flag dated `hoursAgo` in the past. audit_log is append-only
 * (no UPDATE), so we INSERT it backdated through the app path (app_user + RLS
 * satisfied inside withTenant), rather than ageing an existing row.
 */
async function seedBackdatedMetricFlag(orgId: string, metric: string, hoursAgo: number) {
  await withTenant(orgId, (tx) =>
    tx.$executeRaw`
      INSERT INTO "audit_log" ("org_id", "actor_id", "actor_type", "action", "target", "detail", "created_at")
      VALUES (${orgId}::uuid, 'loop-engine', 'agent', 'flag.metric_deviation', ${metric},
              ${JSON.stringify({ category: 'metric', metric })}::jsonb,
              now() - (${hoursAgo} * interval '1 hour'))
    `,
  );
}

describe('dedup (24h window)', () => {
  it('a second tick right after the first raises no duplicate flag', async () => {
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed');

    const first = await runLoopTickForOrg(ORG_A, daysAgo(7));
    expect(first).toBeGreaterThanOrEqual(1);
    const afterFirst = (await metricFlags(ORG_A)).length;

    const second = await runLoopTickForOrg(ORG_A, daysAgo(7));
    expect(second).toBe(0); // deduped
    expect((await metricFlags(ORG_A)).length).toBe(afterFirst);
  });

  it('a flag from ~23h ago (inside the window) still suppresses a new one', async () => {
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed');

    await seedBackdatedMetricFlag(ORG_A, 'success_rate', 23);
    expect((await metricFlags(ORG_A)).length).toBe(1);

    const again = await runLoopTickForOrg(ORG_A, daysAgo(7));
    expect(again).toBe(0); // still within 24h → suppressed
    expect((await metricFlags(ORG_A)).length).toBe(1);
  });

  it('a flag older than 24h does NOT suppress a new one', async () => {
    await seedRun(ORG_A, 's', 'completed');
    await seedRun(ORG_A, 's', 'failed');
    await seedRun(ORG_A, 's', 'failed');

    await seedBackdatedMetricFlag(ORG_A, 'success_rate', 25); // past the 24h horizon
    expect((await metricFlags(ORG_A)).length).toBe(1);

    const again = await runLoopTickForOrg(ORG_A, daysAgo(7));
    expect(again).toBeGreaterThanOrEqual(1); // old flag does not suppress a new one
    expect((await metricFlags(ORG_A)).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Isolation — per-org tx; one tenant's failure does not stop the others
// ---------------------------------------------------------------------------
describe('per-org isolation', () => {
  it('one org failing is counted and skipped; the others still run', async () => {
    // Make ORG_A fail, ORG_B succeed (and raise a flag).
    await seedRun(ORG_B, 's', 'completed');
    await seedRun(ORG_B, 's', 'failed');
    await seedRun(ORG_B, 's', 'failed');

    const result = await runLoopTick({
      runForOrg: async (orgId, since) => {
        if (orgId === ORG_A) throw new Error('boom: ORG_A tenant failed');
        return runLoopTickForOrg(orgId, since);
      },
    });

    expect(result.orgs).toBe(2);
    expect(result.failed).toBe(1); // ORG_A isolated
    expect(result.flagsRaised).toBeGreaterThanOrEqual(1); // ORG_B still flagged
    expect((await metricFlags(ORG_B)).length).toBeGreaterThanOrEqual(1);
  });
});
