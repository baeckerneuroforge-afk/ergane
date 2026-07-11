// =============================================================================
// DURABLE MULTI-STEP + MULTI-CHECKPOINT APPROVAL GATE
//
//   1. drive:'one_step' advances at most one step; continueRun completes the rest.
//   2. Double continue is idempotent (no duplicate done steps at same idx).
//   3. Retriable failure keeps the same runId advanceable under MAX_STEP_ATTEMPTS.
//   4. Two acts:true steps each require their own approval (no run-global clear).
//   5. Approvals carry step_idx / step_name for UI/Slack checkpoint display.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  MAX_STEP_ATTEMPTS,
  __clearTestSkills,
  __registerSkillForTests,
  advanceRunOnce,
  approve,
  continueRun,
  startRun,
  type SkillDef,
  type SkillJson,
} from '../src/lib/skills';

const ORG = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';
const APPROVER = 'durable_lead';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

/** Multi-step read-only skill: three steps, no gates. */
const CHAIN_KEY = 'test_durable_chain';
const chainSkill: SkillDef = {
  key: CHAIN_KEY,
  title: 'Durable chain (test)',
  handlesMoney: false,
  steps: [
    {
      name: 'a',
      run: async () => ({ n: 1 }),
    },
    {
      name: 'b',
      run: async ({ state }) => ({ n: (state.a?.n as number) + 1 }),
    },
    {
      name: 'c',
      run: async ({ state }) => ({ n: (state.b?.n as number) + 1 }),
    },
  ],
};

/** Two acting steps, always-gated (policy always via guardrail always trigger). */
const DUAL_ACT_KEY = 'test_dual_act';
const dualActSkill: SkillDef = {
  key: DUAL_ACT_KEY,
  title: 'Dual acting (test)',
  handlesMoney: false,
  guardrail: () => ({ triggered: true, reason: 'test checkpoint required' }),
  steps: [
    {
      name: 'prep',
      run: async () => ({ ready: true }),
    },
    {
      name: 'act_one',
      acts: true,
      run: async () => ({ did: 'one' }),
    },
    {
      name: 'mid',
      run: async () => ({ mid: true }),
    },
    {
      name: 'act_two',
      acts: true,
      run: async () => ({ did: 'two' }),
    },
  ],
};

/** Flaky step that fails N times then succeeds (retriable). */
const FLAKY_KEY = 'test_flaky_step';
let flakyRemaining = 0;
const flakySkill: SkillDef = {
  key: FLAKY_KEY,
  title: 'Flaky (test)',
  handlesMoney: false,
  steps: [
    {
      name: 'ok',
      run: async () => ({ ok: true }),
    },
    {
      name: 'flaky',
      run: async () => {
        if (flakyRemaining > 0) {
          flakyRemaining -= 1;
          const err = new Error('temporar y network timeout ETIMEDOUT');
          throw err;
        }
        return { recovered: true };
      },
    },
  ],
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_durable', name: 'Durable Org' },
    });
    await tx.membership.create({
      data: { orgId: ORG, userId: APPROVER, role: 'lead' },
    });
  });
}

async function inspect(runId: string) {
  return withTenant(ORG, async (tx) => ({
    run: await tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
    steps: await tx.skillStep.findMany({ where: { runId }, orderBy: { idx: 'asc' } }),
    approvals: await tx.approval.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
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
  await reset();
  await seed();
  __clearTestSkills();
  __registerSkillForTests(chainSkill);
  __registerSkillForTests(dualActSkill);
  __registerSkillForTests(flakySkill);
  flakyRemaining = 0;
});

afterEach(() => {
  __clearTestSkills();
});

describe('durable multi-step (drive one_step + continueRun)', () => {
  it('startRun(one_step) does not complete all steps; continue finishes them', async () => {
    const first = await startRun(ORG, CHAIN_KEY, {}, { drive: 'one_step' });
    expect(first.status).toBe('running');
    let snap = await inspect(first.runId);
    expect(snap.steps.filter((s) => s.status === 'done')).toHaveLength(1);
    expect(snap.steps[0]!.name).toBe('a');
    expect(snap.run.status).not.toBe('completed');

    const second = await continueRun(ORG, first.runId);
    expect(second.status).toBe('running');
    snap = await inspect(first.runId);
    expect(snap.steps.filter((s) => s.status === 'done').map((s) => s.name)).toEqual(['a', 'b']);

    const third = await continueRun(ORG, first.runId);
    expect(third.status).toBe('completed');
    snap = await inspect(first.runId);
    expect(snap.steps.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(snap.steps.every((s) => s.status === 'done')).toBe(true);
    expect(snap.run.result).toMatchObject({
      a: { n: 1 },
      b: { n: 2 },
      c: { n: 3 },
    });
  });

  it('default startRun still drives to terminal (catalog compat)', async () => {
    const handle = await startRun(ORG, CHAIN_KEY, {});
    expect(handle.status).toBe('completed');
    const snap = await inspect(handle.runId);
    expect(snap.steps).toHaveLength(3);
  });
});

describe('idempotent double-continue + retriable failure', () => {
  it('double continue does not create duplicate done steps for the same idx', async () => {
    const { runId } = await startRun(ORG, CHAIN_KEY, {}, { drive: 'one_step' });
    // Concurrent continues after step 0 — claim serializes; never duplicate idx.
    await Promise.all([continueRun(ORG, runId), continueRun(ORG, runId)]);
    let snap = await inspect(runId);
    const idxs = snap.steps.map((s) => s.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
    expect(snap.steps.filter((s) => s.name === 'b' && s.status === 'done').length).toBeLessThanOrEqual(
      1,
    );

    // Drain to completion; extra continue on completed is a no-op (no new steps).
    let guard = 0;
    while (snap.run.status === 'running' && guard++ < 10) {
      await continueRun(ORG, runId);
      snap = await inspect(runId);
    }
    expect(snap.run.status).toBe('completed');
    expect(snap.steps.filter((s) => s.status === 'done')).toHaveLength(3);

    const again = await continueRun(ORG, runId);
    expect(again.status).toBe('completed');
    const after = await inspect(runId);
    expect(after.steps.filter((s) => s.status === 'done')).toHaveLength(3);
  });

  it('retriable failure then successful continue on the SAME runId', async () => {
    flakyRemaining = 1;
    const first = await startRun(ORG, FLAKY_KEY, {}, { drive: 'one_step' });
    expect(first.status).toBe('running');
    const afterFail = await continueRun(ORG, first.runId);
    expect(afterFail.status).toBe('running');
    let snap = await inspect(first.runId);
    expect(snap.steps.find((s) => s.name === 'flaky')).toBeUndefined();
    expect(snap.run.stepAttempts).toBeGreaterThanOrEqual(1);
    expect(snap.run.stepAttempts).toBeLessThan(MAX_STEP_ATTEMPTS);

    const recovered = await continueRun(ORG, first.runId);
    expect(recovered.status).toBe('completed');
    snap = await inspect(first.runId);
    expect(snap.steps.find((s) => s.name === 'flaky')?.status).toBe('done');
    expect(snap.steps.find((s) => s.name === 'flaky')?.detail).toMatchObject({ recovered: true });
  });

  it('exhausted retriable budget permanently fails the run (same runId)', async () => {
    flakyRemaining = 99;
    let handle = await startRun(ORG, FLAKY_KEY, {}, { drive: 'one_step' });
    for (let i = 0; i < MAX_STEP_ATTEMPTS + 2; i++) {
      handle = await continueRun(ORG, handle.runId);
      if (handle.status === 'failed') break;
    }
    expect(handle.status).toBe('failed');
    const snap = await inspect(handle.runId);
    expect(snap.steps.find((s) => s.name === 'flaky')?.status).toBe('failed');
  });
});

describe('multi-checkpoint approvals (step-bound)', () => {
  it('two acts:true steps each pause; first approve does not unlock second', async () => {
    const started = await startRun(ORG, DUAL_ACT_KEY, {}, { drive: 'to_terminal' });
    expect(started.status).toBe('awaiting_approval');

    let snap = await inspect(started.runId);
    expect(snap.steps.map((s) => s.name)).toEqual(['prep']);
    expect(snap.approvals).toHaveLength(1);
    expect(snap.approvals[0]!.stepName).toBe('act_one');
    expect(snap.approvals[0]!.stepIdx).toBe(1);
    expect(snap.approvals[0]!.status).toBe('pending');

    // Approve checkpoint 1 only — should run act_one + mid, then pause at act_two.
    const afterFirst = await approve(ORG, started.runId, APPROVER);
    expect(afterFirst.status).toBe('awaiting_approval');

    snap = await inspect(started.runId);
    expect(snap.steps.map((s) => s.name)).toEqual(['prep', 'act_one', 'mid']);
    expect(snap.steps.find((s) => s.name === 'act_two')).toBeUndefined();
    const pending = snap.approvals.filter((a) => a.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.stepName).toBe('act_two');
    expect(pending[0]!.stepIdx).toBe(3);
    // First approval is decided and bound to act_one — not a global free pass.
    const approved = snap.approvals.filter((a) => a.status === 'approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]!.stepName).toBe('act_one');

    const done = await approve(ORG, started.runId, APPROVER);
    expect(done.status).toBe('completed');
    snap = await inspect(started.runId);
    expect(snap.steps.map((s) => s.name)).toEqual(['prep', 'act_one', 'mid', 'act_two']);
    expect(snap.approvals.filter((a) => a.status === 'approved')).toHaveLength(2);
  });

  it('approve with drive one_step only unlocks the gated step once', async () => {
    const started = await startRun(ORG, DUAL_ACT_KEY, {}, { drive: 'to_terminal' });
    expect(started.status).toBe('awaiting_approval');

    const one = await approve(ORG, started.runId, APPROVER, { drive: 'one_step' });
    // After one advance: act_one done, still more steps.
    expect(['running', 'awaiting_approval']).toContain(one.status);
    const snap = await inspect(started.runId);
    expect(snap.steps.some((s) => s.name === 'act_one' && s.status === 'done')).toBe(true);
  });
});
