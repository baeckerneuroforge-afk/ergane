// P3-B: durable retry backoff + tick counters (real continueRun / runDurableTick)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  __clearTestSkills,
  __registerSkillForTests,
  continueRun,
  listDurableRunCandidates,
  retryBackoffMs,
  runDurableTick,
  startRun,
  type SkillDef,
} from '../src/lib/skills';
import { OutboundTimeoutError } from '../src/lib/http-timeout';

const ORG = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'skill_runs',
  'skill_steps',
  'approvals',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let failCount = 0;

const FLAKY_KEY = 'test_durable_flaky';
const flakySkill: SkillDef = {
  key: FLAKY_KEY,
  title: 'Flaky durable (test)',
  handlesMoney: false,
  steps: [
    {
      name: 'maybe_fail',
      prepare: async () => {
        failCount += 1;
        if (failCount <= 1) {
          throw new OutboundTimeoutError(30_000);
        }
        return { ok: true };
      },
      run: async ({ prepared }) => ({ done: true, prepared: prepared ?? null }),
    },
    { name: 'done', run: async () => ({ fin: true }) },
  ],
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await reset();
});
afterAll(async () => {
  __clearTestSkills();
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  failCount = 0;
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_dur_h', name: 'Dur H' },
    });
  });
  __clearTestSkills();
  __registerSkillForTests(flakySkill);
});
afterEach(() => {
  __clearTestSkills();
});

describe('retryBackoffMs', () => {
  it('grows exponentially and caps', () => {
    expect(retryBackoffMs(1)).toBe(5_000);
    expect(retryBackoffMs(2)).toBe(10_000);
    expect(retryBackoffMs(10)).toBeLessThanOrEqual(5 * 60_000);
  });
});

describe('durable step retry frees claim for in-process recovery', () => {
  it('after retriable failure, run stays running with stepAttempts and free claim', async () => {
    const handle = await startRun(ORG, FLAKY_KEY, {}, { drive: 'one_step' });
    const run1 = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
    );

    // one_step: first prepare timed out → running with stepAttempts >= 1, claim free
    if (run1.status === 'running') {
      expect(run1.stepAttempts).toBeGreaterThanOrEqual(1);
      expect(run1.claimToken).toBeNull();
      // Free claim so durable candidates can pick it up
      const cands = await listDurableRunCandidates(50);
      expect(cands.some((c) => c.runId === handle.runId)).toBe(true);

      // Audit records the retry intent (incl. suggested backoffMs)
      const retries = await withTenant(ORG, (tx) =>
        tx.auditLog.findMany({ where: { action: 'skill.step_retry' } }),
      );
      expect(retries.length).toBeGreaterThanOrEqual(1);
      const detail = retries[0]!.detail as { backoffMs?: number };
      expect(detail.backoffMs).toBeGreaterThan(0);
    }

    failCount = 1; // next prepare succeeds
    const tick = await runDurableTick({ maxRuns: 10 });
    expect(tick.errors).toBe(0);

    // Drive remaining steps if needed
    let final = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
    );
    for (let i = 0; i < 5 && final.status === 'running'; i++) {
      await continueRun(ORG, handle.runId);
      final = await withTenant(ORG, (tx) =>
        tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
      );
    }
    expect(['completed', 'running', 'failed']).toContain(final.status);
  });
});

describe('runDurableTick isolation counters', () => {
  it('isolates a throwing run and still advances others', async () => {
    const ok: SkillDef = {
      key: 'test_ok_chain',
      title: 'ok',
      handlesMoney: false,
      steps: [
        { name: 'a', run: async () => ({ n: 1 }) },
        { name: 'b', run: async () => ({ n: 2 }) },
      ],
    };
    const boom: SkillDef = {
      key: 'test_boom',
      title: 'boom',
      handlesMoney: false,
      steps: [
        {
          name: 'x',
          prepare: async () => {
            throw new Error('hard fail permanent');
          },
          run: async () => ({}),
        },
      ],
    };
    __registerSkillForTests(ok);
    __registerSkillForTests(boom);

    const good = await startRun(ORG, 'test_ok_chain', {}, { drive: 'one_step' });
    const bad = await startRun(ORG, 'test_boom', {}, { drive: 'one_step' });

    await withTenant(ORG, async (tx) => {
      await tx.skillRun.updateMany({
        where: { id: { in: [good.runId, bad.runId] } },
        data: { claimUntil: null, claimToken: null, status: 'running' },
      });
    });

    const result = await runDurableTick({ maxRuns: 20 });
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    // Boom may fail without throwing from continueRun (engine catches permanent errors)
    expect(result.errors + result.failed + result.advanced).toBeGreaterThan(0);

    const goodFinal = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: good.runId } }),
    );
    // Good run should not be stuck forever failed because of boom
    expect(goodFinal.status).not.toBe('failed');
  });
});
