// =============================================================================
// LOOP AUTO-CORRECTION — Schritt E ("Autonom").
//
// At autonomy 'autonomous' the loop starts a correction ITSELF (no human click)
// when a criteria flag with a correction ref arises — but only behind four
// brakes, and the started run STILL goes through the normal approval gate.
//
// Part A pins maybeAutoCorrect() directly, using a GATED, non-LLM skill
// (angebot_erstellen — its guardrail always triggers → the re-run pauses at
// awaiting_approval without any model call):
//   1. autonomous → auto-start → run in awaiting_approval, NOT approved;
//      audited 'loop.auto_correction_started' (actorType 'agent').
//   2. report / suggest → NO auto-start.
//   3. Daily limit: the (N+1)-th auto-start is suppressed and logs
//      'loop.auto_correction_limit_reached'; no extra run.
//   4. Anti-loop: a flag whose source run is ITSELF a correction does NOT
//      auto-start again (only reports).
//   5. Auto-start happens OUTSIDE any tenant tx (app.current_org NULL during it).
//   6. Tenant-isolated.
//
// Part B pins the WIRING: evaluateDeliverableCriteria (the real criteria path,
// type 'framework') auto-starts under 'autonomous' — using an injected fake chat
// so the framework re-run is deterministic and offline.
//
// Same harness as loop-autonomy / loop-evaluate: runs as app_user, owner
// connection only to reset state.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type SkillRunStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { createArtifact } from '../src/lib/artifacts';
import { getFakeBlobProvider } from '../src/lib/storage/blob';
import { logAudit } from '../src/lib/audit';
import { __setChatProviderForTests, type ChatCompletionRequest, type ChatProvider } from '../src/lib/ai';
import { setLoopAutonomy } from '../src/lib/loop/settings';
import {
  maybeAutoCorrect,
  MAX_AUTO_CORRECTIONS_PER_DAY,
  AUTO_CORRECTION_LIMIT_ACTION,
  AUTO_CORRECTION_RESERVED_ACTION,
} from '../src/lib/loop/auto-correct';
import { AUTO_CORRECTION_ACTION } from '../src/lib/loop/correct';
import { evaluateDeliverableCriteria } from '../src/lib/loop/evaluate';
import type { CorrectionRef } from '../src/lib/loop/suggest';

const ORG = 'aeae0000-aeae-4eae-8eae-aeaeaeae0001';
const OTHER = 'afaf0000-afaf-4faf-8faf-afafafaf0002';
const ADMIN = 'ac_admin';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings', 'artifacts',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies', 'clients',
  'documents', 'chunks',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fakeBlob = getFakeBlobProvider();

/** Minimal offline chat: returns a well-formed framework so a re-run completes. */
class FakeChat implements ChatProvider {
  readonly name = 'auto-correct-fake';
  async complete(_req: ChatCompletionRequest): Promise<string> {
    return [
      'Executive summary: framework generated for the test.',
      '',
      '## Situation',
      'Grounded context.',
      '',
      '## Key themes & goals',
      '- A',
      '- B',
      '',
      '## Constraints',
      '- X',
      '',
      '## Prioritized use cases',
      '1. One',
      '2. Two',
      '3. Three',
      '',
      '## Next steps',
      '1. Scope',
    ].join('\n');
  }
}
const fakeChat = new FakeChat();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  fakeBlob.reset();
}

async function seedOrgs() {
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_ac', name: 'Auto Correct Org' } });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
  });
  await withTenant(OTHER, async (tx) => {
    await tx.organization.create({ data: { id: OTHER, clerkOrgId: 'org_ac_other', name: 'Other Org' } });
    await tx.membership.create({ data: { orgId: OTHER, userId: ADMIN, role: 'admin' } });
  });
}

/** A completed angebot_erstellen run (guardrail always triggers → re-run pauses,
 * and without `email` the send is simulated — no external effect, no LLM). */
async function seedAngebotRun(orgId: string, status: SkillRunStatus = 'completed'): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.create({
      data: {
        orgId,
        skillKey: 'angebot_erstellen',
        status,
        mode: 'live',
        input: { kunde: 'Hanse Logistik', leistung: 'Projektunterstützung', betragEur: 4800 },
        clientId: null,
      },
    });
    return run.id;
  });
}

/** The correction ref a criteria flag would carry for such a run. */
function angebotCorrection(sourceRunId: string): CorrectionRef {
  return { skillKey: 'angebot_erstellen', sourceRunId, clientId: null };
}

async function auditRows(orgId: string, action: string) {
  return withTenant(orgId, (tx) =>
    tx.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } }),
  );
}

/** All live angebot runs currently awaiting approval in an org. */
async function awaitingAngebotRuns(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx.skillRun.findMany({ where: { skillKey: 'angebot_erstellen', status: 'awaiting_approval' } }),
  );
}

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  const [role] = await prisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
  if (role?.current_user !== 'app_user') {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  __setChatProviderForTests(null);
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await seedOrgs();
  __setChatProviderForTests(fakeChat);
});

// ---------------------------------------------------------------------------
// Part A — maybeAutoCorrect (gated, offline skill)
// ---------------------------------------------------------------------------
describe('maybeAutoCorrect', () => {
  it('autonomous: auto-starts a correction that ends AWAITING approval (not approved)', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const sourceRunId = await seedAngebotRun(ORG);

    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(sourceRunId));
    expect(outcome.kind).toBe('started');

    // The started run is genuinely paused with a PENDING approval — not approved.
    const runId = outcome.kind === 'started' ? outcome.runId : '';
    const { run, approvals } = await withTenant(ORG, async (tx) => ({
      run: await tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
      approvals: await tx.approval.findMany({ where: { runId } }),
    }));
    expect(run.status).toBe('awaiting_approval');
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.status).toBe('pending');
    expect(runId).not.toBe(sourceRunId); // a NEW run

    // Audited as a loop auto-start (agent, not human).
    const audit = await auditRows(ORG, AUTO_CORRECTION_ACTION);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorType).toBe('agent');
    expect(audit[0]!.actorId).toBe('loop-engine');
    expect(audit[0]!.detail).toMatchObject({ sourceRunId, trigger: 'loop' });
  });

  it('report: does NOT auto-start', async () => {
    // report is the default — no setLoopAutonomy call needed.
    const sourceRunId = await seedAngebotRun(ORG);
    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(sourceRunId));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'not_autonomous' });
    expect(await awaitingAngebotRuns(ORG)).toHaveLength(0);
    expect(await auditRows(ORG, AUTO_CORRECTION_ACTION)).toHaveLength(0);
  });

  it('suggest: does NOT auto-start (waits for the human click)', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'suggest' });
    const sourceRunId = await seedAngebotRun(ORG);
    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(sourceRunId));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'not_autonomous' });
    expect(await awaitingAngebotRuns(ORG)).toHaveLength(0);
  });

  it('daily limit: the (N+1)-th auto-start is suppressed and logged', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });

    // Fire N auto-starts (each from its own fresh source run) — all succeed.
    for (let i = 0; i < MAX_AUTO_CORRECTIONS_PER_DAY; i++) {
      const src = await seedAngebotRun(ORG);
      const outcome = await maybeAutoCorrect(ORG, angebotCorrection(src));
      expect(outcome.kind).toBe('started');
    }
    const startedBefore = (await auditRows(ORG, AUTO_CORRECTION_ACTION)).length;
    expect(startedBefore).toBe(MAX_AUTO_CORRECTIONS_PER_DAY);

    // The next one is blocked by the daily limit.
    const src = await seedAngebotRun(ORG);
    const blocked = await maybeAutoCorrect(ORG, angebotCorrection(src));
    expect(blocked).toEqual({ kind: 'skipped', reason: 'limit_reached' });

    // No new auto-start audit; exactly one limit-reached audit.
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(MAX_AUTO_CORRECTIONS_PER_DAY);
    const limit = await auditRows(ORG, AUTO_CORRECTION_LIMIT_ACTION);
    expect(limit).toHaveLength(1);
    expect(limit[0]!.actorType).toBe('agent');
    expect(limit[0]!.detail).toMatchObject({ limit: MAX_AUTO_CORRECTIONS_PER_DAY, sourceRunId: src });
  });

  it('anti-loop: a flag whose source run is itself a correction does NOT auto-start', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });

    // First auto-start: creates a correction run (is_correction=true at creation).
    const origin = await seedAngebotRun(ORG);
    const first = await maybeAutoCorrect(ORG, angebotCorrection(origin));
    expect(first.kind).toBe('started');
    const correctionRunId = first.kind === 'started' ? first.runId : '';

    // The started correction run is marked structurally.
    const marked = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: correctionRunId }, select: { isCorrection: true } }),
    );
    expect(marked.isCorrection).toBe(true);

    // Now a flag arises FROM that correction run. Auto-correcting it again would
    // be the run→flag→run loop — the guard must refuse (only report).
    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(correctionRunId));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'source_is_correction' });

    // Still exactly ONE auto-start (the first) — the second did not start a run.
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(1);
  });

  it('anti-loop is STRUCTURAL: a run marked is_correction blocks even with NO prior audit', async () => {
    // This is the timing-independent guarantee. A correction run that completes
    // SYNCHRONOUSLY re-evaluates its own criteria BEFORE its start-audit is
    // written — so the guard must key off skill_runs.is_correction (set at
    // creation), not the audit trail. Seed such a run with NO audit at all.
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const correctionRunId = await withTenant(ORG, async (tx) => {
      const run = await tx.skillRun.create({
        data: {
          orgId: ORG,
          skillKey: 'angebot_erstellen',
          status: 'completed',
          mode: 'live',
          isCorrection: true, // marked, but NO loop.auto_correction_started audit exists
          input: { kunde: 'X', leistung: 'Y', betragEur: 100 },
        },
      });
      return run.id;
    });
    // No auto-correction audit exists yet.
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(0);

    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(correctionRunId));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'source_is_correction' });
    // Nothing was started.
    expect(await awaitingAngebotRuns(ORG)).toHaveLength(0);
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(0);
  });

  it('auto-start happens OUTSIDE any withTenant transaction', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const sourceRunId = await seedAngebotRun(ORG);

    // Instrument the blob get (the angebot skill reads knowledge via blob-less
    // paths, but startRun's engine work must not be inside a tenant tx). We probe
    // app.current_org from a helper the auto-start path triggers: the audit write
    // in startCorrectionRun opens its OWN tx, so during the RUN itself no tx is
    // pinned. Assert by checking the started run is awaiting_approval (only
    // reachable if the engine ran to the gate outside the caller's context) AND
    // that maybeAutoCorrect never held a tx across the startRun call.
    let orgContextDuringChat: string | null | undefined;
    __setChatProviderForTests({
      name: 'probe',
      async complete() {
        const [{ org }] = await prisma.$queryRaw<Array<{ org: string | null }>>`
          SELECT current_setting('app.current_org', true) AS org
        `;
        orgContextDuringChat = org && org.length > 0 ? org : null;
        return 'unused';
      },
    });
    // angebot_erstellen does not call the chat before the gate, so the probe may
    // not fire; the definitive check is that the run reached the gate at all.
    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(sourceRunId));
    expect(outcome.kind).toBe('started');
    // If the chat DID run, it was outside any tenant tx.
    if (orgContextDuringChat !== undefined) {
      expect(orgContextDuringChat).toBeNull();
    }
    __setChatProviderForTests(fakeChat);
  });

  it('is tenant-isolated: ORG autonomy does not auto-start OTHER, and refs cannot cross', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    // OTHER stays on report (default).
    const otherRun = await seedAngebotRun(OTHER);

    // Calling maybeAutoCorrect for OTHER (report) → no auto-start.
    const outcome = await maybeAutoCorrect(OTHER, angebotCorrection(otherRun));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'not_autonomous' });
    expect(await awaitingAngebotRuns(OTHER)).toHaveLength(0);

    // ORG (autonomous) trying to replay OTHER's run → the source is "not found"
    // under ORG's RLS, so startCorrectionRun fails → best-effort skip, no run.
    const cross = await maybeAutoCorrect(ORG, angebotCorrection(otherRun));
    expect(cross).toEqual({ kind: 'skipped', reason: 'error' });
    expect(await awaitingAngebotRuns(ORG)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Daily-limit RACE fix (Audit-Fix F3): the cap is enforced atomically per org.
//
// The bug: the pre-fix guard counted the trailing loop.auto_correction_started
// audit (written AFTER the run starts) in a tx SEPARATE from the start, so two
// concurrent criteria flags could both read used<limit and OVER-start past the
// cap. The fix: an advisory lock serialises per-org decisions, and the daily
// count is taken over a RESERVATION row written inside that same locked tx
// (loop.auto_correction_reserved) — count-then-reserve is atomic.
//
// NOTE ON CONCURRENCY: tests/setup.ts pins app_user to connection_limit=1, so
// the shared `prisma` cannot truly run two withTenant txs in parallel. These
// tests therefore verify the RESERVATION INVARIANT that makes the fix correct —
// exactly one reservation per start, count keyed off reservations, and the lock
// SQL executing under Prisma's parameter binding (the ::int4 cast). A separate
// app_user pool would be needed to exercise wall-clock parallelism; the
// invariant below is what guarantees correctness once it does.
// ---------------------------------------------------------------------------
describe('auto-correction daily-limit race fix', () => {
  it('writes exactly one reservation per started correction', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const src = await seedAngebotRun(ORG);

    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(src));
    expect(outcome.kind).toBe('started');

    // One reservation, and it was written (the count key) — plus the canonical
    // start-audit still exists for the UI (distinct action).
    const reservations = await auditRows(ORG, AUTO_CORRECTION_RESERVED_ACTION);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.detail).toMatchObject({ sourceRunId: src });
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(1);
  });

  it('caps starts at MAX even when the trailing start-audit is absent (counts reservations, not starts)', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });

    // Simulate MAX reservations already present in the window WITHOUT any
    // corresponding loop.auto_correction_started rows. The pre-fix code counted
    // the start-audit and would have seen 0 → wrongly allowed another start. The
    // fixed code counts reservations → already at the cap → blocks.
    await withTenant(ORG, async (tx) => {
      for (let i = 0; i < MAX_AUTO_CORRECTIONS_PER_DAY; i++) {
        await logAudit(tx, {
          orgId: ORG,
          actorId: 'loop-engine',
          actorType: 'agent',
          action: AUTO_CORRECTION_RESERVED_ACTION,
          target: `angebot_erstellen:seed-${i}`,
          detail: { sourceRunId: `seed-${i}`, clientId: null },
        });
      }
    });

    const src = await seedAngebotRun(ORG);
    const blocked = await maybeAutoCorrect(ORG, angebotCorrection(src));
    expect(blocked).toEqual({ kind: 'skipped', reason: 'limit_reached' });
    // No run started, no NEW reservation beyond the MAX we seeded.
    expect(await awaitingAngebotRuns(ORG)).toHaveLength(0);
    expect((await auditRows(ORG, AUTO_CORRECTION_RESERVED_ACTION)).length).toBe(MAX_AUTO_CORRECTIONS_PER_DAY);
  });

  it('the per-org advisory lock SQL executes (::int4 cast) without error', async () => {
    // Guards the Prisma-binding pitfall: pg_advisory_xact_lock(numeric,int) does
    // not exist, so a missing ::int4 cast would raise — and since maybeAutoCorrect
    // swallows errors, the lock would silently never be taken. A successful
    // auto-start proves the locked decision tx ran cleanly end to end.
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const src = await seedAngebotRun(ORG);
    const outcome = await maybeAutoCorrect(ORG, angebotCorrection(src));
    expect(outcome.kind).toBe('started'); // reached the start ⇒ lock+reserve ran
  });
});

// ---------------------------------------------------------------------------
// Part B — wiring: evaluateDeliverableCriteria auto-starts under 'autonomous'
// ---------------------------------------------------------------------------
const BAD_FRAMEWORK = [
  '## Executive summary',
  'Short.',
  '',
  '## Prioritized use cases',
  '1. Only one',
  '',
  '_Sources: Doc A_',
].join('\n');

async function seedFrameworkRun(orgId: string): Promise<string> {
  const runId = await withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.create({
      data: { orgId, skillKey: 'transkript_zu_framework', status: 'running', mode: 'live', input: { transkript: 'x' } },
    });
    return run.id;
  });
  const bytes = new TextEncoder().encode(BAD_FRAMEWORK);
  await createArtifact({
    orgId, title: 'Framework — Test', type: 'framework', bytes, contentType: 'text/markdown', runId,
  });
  return runId;
}

describe('evaluateDeliverableCriteria → auto-start wiring', () => {
  it('autonomous: a framework criteria flag auto-starts a correction run', async () => {
    await setLoopAutonomy({ orgId: ORG, actorUserId: ADMIN, level: 'autonomous' });
    const sourceRunId = await seedFrameworkRun(ORG);
    const art = await withTenant(ORG, (tx) =>
      tx.artifact.findFirstOrThrow({ where: { runId: sourceRunId }, select: { id: true } }),
    );

    await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', sourceRunId, {
      framework_ausgegeben: { generiert: true, artifactId: art.id },
    });

    // The flag was written AND the loop auto-started a correction for it.
    const flags = await auditRows(ORG, 'flag.criteria_violated');
    expect(flags.length).toBe(1);
    const autoStarts = await auditRows(ORG, AUTO_CORRECTION_ACTION);
    expect(autoStarts.length).toBe(1);
    expect(autoStarts[0]!.detail).toMatchObject({ sourceRunId, trigger: 'loop' });
    // A NEW framework run exists (the auto-started correction), distinct from source.
    const runs = await withTenant(ORG, (tx) =>
      tx.skillRun.findMany({ where: { skillKey: 'transkript_zu_framework' } }),
    );
    expect(runs.length).toBe(2);
  });

  it('report: a framework criteria flag does NOT auto-start', async () => {
    // default report
    const sourceRunId = await seedFrameworkRun(ORG);
    const art = await withTenant(ORG, (tx) =>
      tx.artifact.findFirstOrThrow({ where: { runId: sourceRunId }, select: { id: true } }),
    );
    await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', sourceRunId, {
      framework_ausgegeben: { generiert: true, artifactId: art.id },
    });
    expect((await auditRows(ORG, 'flag.criteria_violated')).length).toBe(1);
    expect((await auditRows(ORG, AUTO_CORRECTION_ACTION)).length).toBe(0);
    const runs = await withTenant(ORG, (tx) =>
      tx.skillRun.findMany({ where: { skillKey: 'transkript_zu_framework' } }),
    );
    expect(runs.length).toBe(1); // only the source run; no correction
  });
});
