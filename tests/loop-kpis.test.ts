// =============================================================================
// LOOP KPI SNAPSHOT
//
//   1. Flags / corrections / pending approvals counted in window.
//   2. Approval latency median from real decided approvals.
//   3. Process metrics healthy count from computeLoopMetrics.
//   4. Tenant isolation: org B's flags never inflate org A's KPIs.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  computeLoopKpis,
  formatApprovalLatencyMs,
  LOOP_KPI_WINDOW_DAYS,
} from '../src/lib/loop/kpis';

const ORG_A = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b101';
const ORG_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b202';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log',
  'skill_runs', 'skill_steps', 'approvals',
  'chat_messages', 'chat_feedback', 'documents', 'chunks',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
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
  await reset();
  for (const [id, clerk, name] of [
    [ORG_A, 'org_kpi_a', 'KPI A'],
    [ORG_B, 'org_kpi_b', 'KPI B'],
  ] as const) {
    await withTenant(id, async (tx) => {
      await tx.organization.create({ data: { id, clerkOrgId: clerk, name } });
    });
  }
});

describe('computeLoopKpis', () => {
  it('counts flags and corrections in the window; ignores other tenant', async () => {
    await withTenant(ORG_A, async (tx) => {
      await tx.auditLog.create({
        data: {
          orgId: ORG_A,
          actorId: 'loop-engine',
          actorType: 'agent',
          action: 'flag.metric_deviation',
          target: 'success_rate',
        },
      });
      await tx.auditLog.create({
        data: {
          orgId: ORG_A,
          actorId: 'human',
          actorType: 'human',
          action: 'flag.correction_requested',
          target: 'run:1',
        },
      });
      await tx.auditLog.create({
        data: {
          orgId: ORG_A,
          actorId: 'loop-engine',
          actorType: 'agent',
          action: 'loop.auto_correction_started',
          target: 'skill:run-x',
        },
      });
    });
    await withTenant(ORG_B, async (tx) => {
      await tx.auditLog.create({
        data: {
          orgId: ORG_B,
          actorId: 'loop-engine',
          actorType: 'agent',
          action: 'flag.metric_deviation',
          target: 'success_rate',
        },
      });
    });

    const kpis = await withTenant(ORG_A, (tx) => computeLoopKpis(tx, ORG_A));
    expect(kpis.flags).toBe(1);
    expect(kpis.humanCorrections).toBe(1);
    expect(kpis.autoCorrections).toBe(1);
    expect(kpis.corrections).toBe(2);
    expect(LOOP_KPI_WINDOW_DAYS).toBe(7);
  });

  it('computes median approval latency from decided approvals', async () => {
    const now = Date.now();
    await withTenant(ORG_A, async (tx) => {
      // Need skill runs for FK on approvals
      const run1 = await tx.skillRun.create({
        data: {
          orgId: ORG_A,
          skillKey: 'beleg_kontieren',
          status: 'completed',
          mode: 'live',
          input: {},
        },
      });
      const run2 = await tx.skillRun.create({
        data: {
          orgId: ORG_A,
          skillKey: 'beleg_kontieren',
          status: 'completed',
          mode: 'live',
          input: {},
        },
      });
      await tx.approval.create({
        data: {
          orgId: ORG_A,
          runId: run1.id,
          reason: 'test',
          status: 'approved',
          createdAt: new Date(now - 20 * 60_000),
          decidedAt: new Date(now - 10 * 60_000), // 10 min latency
        },
      });
      await tx.approval.create({
        data: {
          orgId: ORG_A,
          runId: run2.id,
          reason: 'test',
          status: 'approved',
          createdAt: new Date(now - 60 * 60_000),
          decidedAt: new Date(now - 30 * 60_000), // 30 min latency
        },
      });
    });

    const kpis = await withTenant(ORG_A, (tx) => computeLoopKpis(tx, ORG_A));
    // Median of 10m and 30m = 20m
    expect(kpis.approvalLatencyMedianMs).toBe(20 * 60_000);
    expect(formatApprovalLatencyMs(kpis.approvalLatencyMedianMs, 'en')).toMatch(/20 min/);
  });

  it('returns null latency when nothing decided', async () => {
    const kpis = await withTenant(ORG_A, (tx) => computeLoopKpis(tx, ORG_A));
    expect(kpis.approvalLatencyMedianMs).toBeNull();
    // 4 classic + 2 ticket tool + 2 cross-signal metrics (commits/tickets).
    expect(kpis.processMetricsTotal).toBe(8);
    expect(kpis.processMetricsHealthy).toBe(8); // empty org → metrics pass (no false alarms)
  });
});

describe('static wiring', () => {
  it('cockpit and connectors surface use loop KPIs / honest roadmap', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '..');
    const cockpit = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(cockpit).toMatch(/computeLoopKpis/);
    expect(cockpit).toMatch(/loopKpisTitle/);
    const connectors = readFileSync(join(root, 'src/app/dashboard/connectors/page.tsx'), 'utf8');
    expect(connectors).toMatch(/honestNote/);
    expect(connectors).toMatch(/statusShipped|shipped/);
    const runbook = readFileSync(join(root, 'docs/yc-demo-runbook.md'), 'utf8');
    expect(runbook).toMatch(/Clerk ↔ seed bridge|Clerk.*seed/i);
    expect(runbook).toMatch(/approve moment|pending/i);
  });
});
