// =============================================================================
// VALUE DASHBOARD ("Automation Score")
//
// The dashboard is pure aggregation over skill_runs: live runs, success rate,
// saved hours and their USD equivalent (assumptions from org_settings, code
// defaults when unset). This suite pins the load-bearing properties:
//
//   (a) formatMoney/CURRENCY — the ONE currency authority formats USD (en-US).
//   (b) defaults — a fresh org gets $60/h and per-skill default minutes.
//   (c) settings — admin-gated, audited, overrides resolved against defaults.
//   (d) aggregation — counts/hours/USD are correct, success rate included.
//   (e) CRITICAL: mode='simulation' runs NEVER count — not in totals, not per
//       skill, not per month. An org with ONLY simulations reports zero value.
//   (f) tenant isolation — one org's stats never include another org's runs.
//
// Same harness as skill-dry-run.test.ts: runs as `app_user`, owner connection
// only to reset state between cases.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type SkillRunMode, type SkillRunStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { CURRENCY, formatMoney } from '../src/lib/money';
import {
  DEFAULT_HOURLY_RATE_USD,
  DEFAULT_MINUTES_SAVED,
  computeValueStats,
  getValueSettings,
  setValueSettings,
} from '../src/lib/value';

const ORG_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const ORG_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const ADMIN = 'val_admin';
const MEMBER = 'val_member';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings',
  'skill_runs', 'skill_steps', 'approvals',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Seed one skill_run row inside the org's own tenant transaction. */
async function seedRun(
  orgId: string,
  skillKey: string,
  status: SkillRunStatus,
  mode: SkillRunMode,
  createdAt: Date,
) {
  await withTenant(orgId, (tx) =>
    tx.skillRun.create({
      data: { orgId, skillKey, status, mode, input: {}, createdAt },
    }),
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
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_val_a', name: 'Value Org A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: ADMIN, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER, role: 'member' } });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_val_b', name: 'Value Org B' } });
  });
});

// --- (a) money formatting — the single currency authority --------------------------------

describe('(a) formatMoney — USD, en-US, one central place', () => {
  it('formats amounts as USD', () => {
    expect(CURRENCY).toBe('USD');
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(135)).toBe('$135.00');
  });
});

// --- (b) defaults ------------------------------------------------------------------------

describe('(b) value assumptions default sensibly', () => {
  it('a fresh org (no org_settings row) gets the $60/h default and per-skill minutes', async () => {
    const settings = await withTenant(ORG_A, (tx) => getValueSettings(tx, ORG_A));
    expect(settings.hourlyRateUsd).toBe(DEFAULT_HOURLY_RATE_USD);
    expect(settings.hourlyRateUsd).toBe(60);
    expect(settings.minutesPerSkill.angebot_erstellen).toBe(DEFAULT_MINUTES_SAVED.angebot_erstellen);
    // Every catalog skill resolves to a number — no undefined leaks into math.
    for (const minutes of Object.values(settings.minutesPerSkill)) {
      expect(Number.isFinite(minutes)).toBe(true);
    }
  });
});

// --- (c) settings are admin-gated, audited, and override the defaults --------------------

describe('(c) setValueSettings', () => {
  it('a member may NOT change the assumptions (fail-closed)', async () => {
    await expect(
      setValueSettings({
        orgId: ORG_A,
        actorUserId: MEMBER,
        hourlyRateUsd: 100,
        minutesPerSkill: {},
      }),
    ).rejects.toThrow(/admin required/);
  });

  it('rejects an unknown skill key and implausible numbers', async () => {
    await expect(
      setValueSettings({
        orgId: ORG_A,
        actorUserId: ADMIN,
        hourlyRateUsd: 100,
        minutesPerSkill: { not_a_skill: 10 },
      }),
    ).rejects.toThrow(/Unknown skill/);
    await expect(
      setValueSettings({ orgId: ORG_A, actorUserId: ADMIN, hourlyRateUsd: -5, minutesPerSkill: {} }),
    ).rejects.toThrow(/Hourly rate/);
    await expect(
      setValueSettings({
        orgId: ORG_A,
        actorUserId: ADMIN,
        hourlyRateUsd: 100,
        minutesPerSkill: { angebot_erstellen: -1 },
      }),
    ).rejects.toThrow(/Minutes saved/);
  });

  it('an admin change persists, is audited, and partial maps keep defaults elsewhere', async () => {
    await setValueSettings({
      orgId: ORG_A,
      actorUserId: ADMIN,
      hourlyRateUsd: 90,
      minutesPerSkill: { angebot_erstellen: 30 },
    });

    const settings = await withTenant(ORG_A, (tx) => getValueSettings(tx, ORG_A));
    expect(settings.hourlyRateUsd).toBe(90);
    expect(settings.minutesPerSkill.angebot_erstellen).toBe(30);
    // Untouched skill falls back to its code default.
    expect(settings.minutesPerSkill.beleg_kontieren).toBe(DEFAULT_MINUTES_SAVED.beleg_kontieren);

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'policy.changed', target: 'org_settings:value_assumptions' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(ADMIN);
  });
});

// --- (d) aggregation correctness ----------------------------------------------------------

describe('(d) computeValueStats aggregates live runs correctly', () => {
  it('counts, success rate, hours and USD from completed live runs (defaults: 45 min, $60/h)', async () => {
    // 3 completed + 1 failed + 1 rejected live runs, all inside the window.
    for (let i = 0; i < 3; i++) await seedRun(ORG_A, 'angebot_erstellen', 'completed', 'live', daysAgo(2));
    await seedRun(ORG_A, 'angebot_erstellen', 'failed', 'live', daysAgo(3));
    await seedRun(ORG_A, 'angebot_erstellen', 'rejected', 'live', daysAgo(4));
    // One live run OUTSIDE the window must not count.
    await seedRun(ORG_A, 'angebot_erstellen', 'completed', 'live', daysAgo(60));

    const stats = await withTenant(ORG_A, (tx) =>
      computeValueStats(tx, ORG_A, { since: daysAgo(30) }),
    );

    expect(stats.totalRuns).toBe(5);
    expect(stats.completedRuns).toBe(3);
    expect(stats.rejectedOrFailedRuns).toBe(2);
    expect(stats.successRate).toBeCloseTo(3 / 5);
    // 3 completed × 45 min = 135 min = 2.25 h × $60 = $135.
    expect(stats.savedHours).toBe(2.25);
    expect(stats.savedUsd).toBe(135);
    expect(formatMoney(stats.savedUsd)).toBe('$135.00');

    expect(stats.perSkill).toHaveLength(1);
    expect(stats.perSkill[0]).toMatchObject({
      skillKey: 'angebot_erstellen',
      runs: 5,
      completed: 3,
      savedHours: 2.25,
      savedUsd: 135,
    });

    // Monthly buckets cover exactly the in-window runs.
    expect(stats.months.reduce((sum, m) => sum + m.runs, 0)).toBe(5);
    expect(stats.months.reduce((sum, m) => sum + m.savedUsd, 0)).toBeCloseTo(135);
  });

  it('uses the org-specific assumptions once set', async () => {
    await setValueSettings({
      orgId: ORG_A,
      actorUserId: ADMIN,
      hourlyRateUsd: 100,
      minutesPerSkill: { beleg_kontieren: 6 },
    });
    for (let i = 0; i < 10; i++) await seedRun(ORG_A, 'beleg_kontieren', 'completed', 'live', daysAgo(1));

    const stats = await withTenant(ORG_A, (tx) =>
      computeValueStats(tx, ORG_A, { since: daysAgo(30) }),
    );
    // 10 × 6 min = 1 h × $100 = $100.
    expect(stats.savedHours).toBe(1);
    expect(stats.savedUsd).toBe(100);
  });
});

// --- (e) CRITICAL: simulations never count ------------------------------------------------

describe('(e) mode="simulation" runs are excluded from EVERY value figure', () => {
  it('an org with ONLY simulation runs reports zero value', async () => {
    // Even completed simulations — the strongest case: they LOOK like value.
    for (let i = 0; i < 5; i++) await seedRun(ORG_A, 'angebot_erstellen', 'completed', 'simulation', daysAgo(1));
    await seedRun(ORG_A, 'beleg_kontieren', 'failed', 'simulation', daysAgo(2));

    const stats = await withTenant(ORG_A, (tx) =>
      computeValueStats(tx, ORG_A, { since: daysAgo(30) }),
    );
    expect(stats.totalRuns).toBe(0);
    expect(stats.completedRuns).toBe(0);
    expect(stats.rejectedOrFailedRuns).toBe(0);
    expect(stats.successRate).toBeNull();
    expect(stats.savedHours).toBe(0);
    expect(stats.savedUsd).toBe(0);
    expect(stats.perSkill).toHaveLength(0);
    expect(stats.months).toHaveLength(0);
  });

  it('mixed live + simulation: only the live runs count', async () => {
    await seedRun(ORG_A, 'angebot_erstellen', 'completed', 'live', daysAgo(1));
    for (let i = 0; i < 7; i++) await seedRun(ORG_A, 'angebot_erstellen', 'completed', 'simulation', daysAgo(1));

    const stats = await withTenant(ORG_A, (tx) =>
      computeValueStats(tx, ORG_A, { since: daysAgo(30) }),
    );
    expect(stats.totalRuns).toBe(1);
    expect(stats.completedRuns).toBe(1);
    // 1 × 45 min = 0.75 h × $60 = $45 — the 7 simulations added nothing.
    expect(stats.savedUsd).toBe(45);
    expect(stats.perSkill[0]?.runs).toBe(1);
    expect(stats.months.reduce((sum, m) => sum + m.runs, 0)).toBe(1);
  });
});

// --- (f) tenant isolation ------------------------------------------------------------------

describe('(f) stats are tenant-isolated (withTenant/RLS)', () => {
  it("org A's stats never include org B's live runs", async () => {
    for (let i = 0; i < 4; i++) await seedRun(ORG_B, 'angebot_erstellen', 'completed', 'live', daysAgo(1));
    await seedRun(ORG_A, 'beleg_kontieren', 'completed', 'live', daysAgo(1));

    const statsA = await withTenant(ORG_A, (tx) =>
      computeValueStats(tx, ORG_A, { since: daysAgo(30) }),
    );
    expect(statsA.totalRuns).toBe(1);
    expect(statsA.perSkill.map((r) => r.skillKey)).toEqual(['beleg_kontieren']);

    const statsB = await withTenant(ORG_B, (tx) =>
      computeValueStats(tx, ORG_B, { since: daysAgo(30) }),
    );
    expect(statsB.totalRuns).toBe(4);
  });
});
