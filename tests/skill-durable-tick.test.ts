// =============================================================================
// DURABLE BACKGROUND TICK GATE
//
//   1. Multi-step run with drive:'one_step' completes solely via runDurableTick
//      (real continueRun path).
//   2. Active claim lease ⇒ not discovered / not advanced.
//   3. Failure on one run does not stop others in the same tick.
//   4. Cron route: no secret → 503, wrong bearer → 401, ok → 200 counters only.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  __clearTestSkills,
  __registerSkillForTests,
  listDurableRunCandidates,
  runDurableTick,
  startRun,
  type SkillDef,
} from '../src/lib/skills';
import { GET as cronGet } from '../src/app/api/cron/skills-durable/route';

const ORG_A = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';
const ORG_B = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const CHAIN_KEY = 'test_tick_chain';
const chainSkill: SkillDef = {
  key: CHAIN_KEY,
  title: 'Tick chain (test)',
  handlesMoney: false,
  steps: [
    { name: 'a', run: async () => ({ n: 1 }) },
    { name: 'b', run: async ({ state }) => ({ n: (state.a?.n as number) + 1 }) },
    { name: 'c', run: async ({ state }) => ({ n: (state.b?.n as number) + 1 }) },
  ],
};

const GHOST_KEY = 'test_tick_ghost';

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrgs() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_tick_a', 'Tick A'],
    [ORG_B, 'org_tick_b', 'Tick B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
    });
  }
}

async function inspect(orgId: string, runId: string) {
  return withTenant(orgId, async (tx) => ({
    run: await tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
    steps: await tx.skillStep.findMany({ where: { runId }, orderBy: { idx: 'asc' } }),
  }));
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
  __clearTestSkills();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  delete process.env.CRON_SECRET;
  await reset();
  await seedOrgs();
  __clearTestSkills();
  __registerSkillForTests(chainSkill);
});

afterEach(() => {
  __clearTestSkills();
  delete process.env.CRON_SECRET;
});

describe('runDurableTick advances one_step runs via real continueRun', () => {
  it('completes a multi-step durable run solely via ticks', async () => {
    const started = await startRun(ORG_A, CHAIN_KEY, {}, { drive: 'one_step' });
    expect(started.status).toBe('running');
    let snap = await inspect(ORG_A, started.runId);
    expect(snap.steps).toHaveLength(1);

    let tick = await runDurableTick();
    expect(tick.candidates).toBeGreaterThanOrEqual(1);
    expect(tick.advanced).toBeGreaterThanOrEqual(1);
    snap = await inspect(ORG_A, started.runId);
    expect(snap.steps.map((s) => s.name)).toEqual(['a', 'b']);
    expect(snap.run.status).toBe('running');

    tick = await runDurableTick();
    snap = await inspect(ORG_A, started.runId);
    expect(snap.run.status).toBe('completed');
    expect(snap.steps.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(tick.completed).toBeGreaterThanOrEqual(1);
  });

  it('listDurableRunCandidates returns only free advanceable runs without tenant context', async () => {
    const a = await startRun(ORG_A, CHAIN_KEY, {}, { drive: 'one_step' });
    await startRun(ORG_B, CHAIN_KEY, {}, { drive: 'to_terminal' }); // completed

    const list = await listDurableRunCandidates(50);
    expect(list.some((c) => c.runId === a.runId && c.orgId === ORG_A)).toBe(true);
    expect(list.filter((c) => c.orgId === ORG_B)).toHaveLength(0);
  });
});

describe('claim lease skip + failure isolation', () => {
  it('does not list or advance a run with an active claim lease', async () => {
    const { runId } = await startRun(ORG_A, CHAIN_KEY, {}, { drive: 'one_step' });
    expect((await listDurableRunCandidates(50)).some((c) => c.runId === runId)).toBe(true);

    await admin.$executeRawUnsafe(
      `UPDATE "skill_runs"
       SET "claim_until" = now() + interval '10 minutes',
           "claim_token" = 'held-by-test'
       WHERE "id" = '${runId}'`,
    );

    expect((await listDurableRunCandidates(50)).some((c) => c.runId === runId)).toBe(false);

    const stepsBefore = (await inspect(ORG_A, runId)).steps.length;
    await runDurableTick();
    expect((await inspect(ORG_A, runId)).steps.length).toBe(stepsBefore);
  });

  it('isolates per-run failures: ghost skill error does not block chain advance', async () => {
    __registerSkillForTests({
      key: GHOST_KEY,
      title: 'Ghost',
      handlesMoney: false,
      steps: [
        { name: 'x', run: async () => ({ ok: true }) },
        { name: 'y', run: async () => ({ ok: true }) },
      ],
    });

    const good = await startRun(ORG_A, CHAIN_KEY, {}, { drive: 'one_step' });
    const ghost = await startRun(ORG_B, GHOST_KEY, {}, { drive: 'one_step' });
    expect(good.status).toBe('running');
    expect(ghost.status).toBe('running');

    // Ghost skill disappears → continueRun throws on getSkill; chain remains.
    __clearTestSkills();
    __registerSkillForTests(chainSkill);

    const tick = await runDurableTick();
    expect(tick.candidates).toBeGreaterThanOrEqual(2);
    expect(tick.errors).toBeGreaterThanOrEqual(1);

    const goodSnap = await inspect(ORG_A, good.runId);
    // Chain advanced at least one step beyond the initial 'a'.
    expect(goodSnap.steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/cron/skills-durable auth', () => {
  it('returns 503 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await cronGet(new Request('http://localhost/api/cron/skills-durable'));
    expect(res.status).toBe(503);
  });

  it('returns 401 when bearer is wrong', async () => {
    process.env.CRON_SECRET = 'correct-secret-value-xx';
    const res = await cronGet(
      new Request('http://localhost/api/cron/skills-durable', {
        headers: { authorization: 'Bearer wrong-secret-value-xx' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with counters when authorized', async () => {
    process.env.CRON_SECRET = 'correct-secret-value-xx';
    await startRun(ORG_A, CHAIN_KEY, {}, { drive: 'one_step' });
    const res = await cronGet(
      new Request('http://localhost/api/cron/skills-durable', {
        headers: { authorization: 'Bearer correct-secret-value-xx' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.candidates).toBe('number');
    expect(typeof body.advanced).toBe('number');
    expect(JSON.stringify(body)).not.toContain(ORG_A);
  });
});

describe('static wiring', () => {
  it('vercel.json schedules the durable cron and tick calls continueRun', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '..');
    const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
    expect(vercel).toMatch(/skills-durable/);
    const tickSrc = readFileSync(join(root, 'src/lib/skills/durable-tick.ts'), 'utf8');
    expect(tickSrc).toMatch(/continueRun/);
    expect(tickSrc).toMatch(/durable_skill_run_candidates/);
  });
});
