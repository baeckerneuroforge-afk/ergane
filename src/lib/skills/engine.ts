// Skill execution engine: guardrail → human approval → audit, per tenant.
//
// Durable multi-step (Phase durable / multi-checkpoint):
//
//   startRun()  → creates the run, then either advances ONE step (drive:'one_step')
//                 or drives to the next gate/terminal (default 'to_terminal',
//                 product/dashboard compat).
//   continueRun() / advanceRunOnce() → at most ONE durable step advance.
//   approve()   → decides the pending checkpoint, then drives remaining steps
//                 until the next gate or terminal (default).
//
// Invariants (unchanged):
//   - Every DB access inside withTenant(orgId, …) — RLS, fail closed.
//   - Step effect + skill_step row + audit share one transaction.
//   - Money failsafe + policies + simulation never awaiting_approval.
//
// Approvals are STEP-BOUND (step_idx + step_name). An approved checkpoint
// clears ONLY that acting step; a later acts:true step re-evaluates the gate.
// Legacy approvals with NULL step_idx (pre-0030) still clear any step (compat).
//
// Claims (claim_token / claim_until) serialize concurrent continue/resume.
// Retriable step failures keep the run running under MAX_STEP_ATTEMPTS and do
// not write a permanent failed step until the budget is exhausted.
import { randomUUID } from 'node:crypto';
import { Prisma, type Role, type SkillRun, type SkillRunMode } from '@prisma/client';
import { logAudit } from '../audit';
import { OutboundTimeoutError } from '../http-timeout';
import { evaluateDeliverableCriteria } from '../loop/evaluate';
import { assertWithinDailyLimit } from '../limits';
import { getMemberRole, roleSatisfies } from '../policies';
import { withTenant } from '../tenant';
import { getSkill } from './catalog';
import { notifyApprovalRequested } from './notify';
import type { SkillDef, SkillJson, StepDef } from './types';

export interface RunHandle {
  runId: string;
  status: SkillRun['status'];
}

const ENGINE_ACTOR = 'skill-engine';

/** Max retriable attempts for the current next step (including the first try). */
export const MAX_STEP_ATTEMPTS = 3;

/** Claim lease length for advanceRunOnce (ms). */
export const CLAIM_LEASE_MS = 60_000;

/** How far startRun/approve drive after create/decide. */
export type DriveMode = 'to_terminal' | 'one_step';

function asJson(value: SkillJson): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isAdvanceable(status: SkillRun['status']): boolean {
  return status === 'running' || status === 'approved';
}

/** Retriable: timeouts / transient network-ish failures. Permanent otherwise. */
export function isRetriableStepError(err: unknown): boolean {
  if (err instanceof OutboundTimeoutError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'OutboundTimeoutError' || err.name === 'TimeoutError' || err.name === 'AbortError') {
    return true;
  }
  return /timeout|temporar|ECONNRESET|ECONNREFUSED|ETIMEDOUT|503|502|429|fetch failed/i.test(
    err.message,
  );
}

/** Options for a run. */
export interface StartRunOptions {
  /**
   * 'live' (default) = real execution. 'simulation' = dry-run ("Probelauf"):
   * guardrails and the approval-need check still run and are recorded, but every
   * acting step is SIMULATED instead of executed — nothing leaves the system and
   * the run never pauses in awaiting_approval.
   */
  mode?: SkillRunMode;
  /** Optional link to a client entity. NULL = run not associated with a client. */
  clientId?: string | null;
  /**
   * True when this run is started AS a loop correction (Schritt E). Persisted on
   * the run at creation so the run's OWN end-of-run criteria evaluation sees it
   * and never auto-corrects a correction run again (the anti-loop guard). Only
   * startCorrectionRun sets this; every other start leaves it false.
   */
  isCorrection?: boolean;
  /**
   * 'to_terminal' (default) = keep advancing in this invocation until
   * awaiting_approval | completed | failed | rejected — preserves catalog UX.
   * 'one_step' = durable mode: create + at most one step advance; caller uses
   * continueRun() for further steps.
   */
  drive?: DriveMode;
}

/**
 * Start a new run of `skillKey` for the tenant.
 * Default drive completes or pauses at the first gate (product compat).
 * With drive:'one_step', only the first durable advance runs.
 */
export async function startRun(
  orgId: string,
  skillKey: string,
  input: SkillJson,
  opts: StartRunOptions = {},
): Promise<RunHandle> {
  const skill = getSkill(skillKey);
  const mode: SkillRunMode = opts.mode ?? 'live';
  const clientId = opts.clientId ?? null;
  const isCorrection = opts.isCorrection ?? false;
  const drive: DriveMode = opts.drive ?? 'to_terminal';

  const run = await withTenant(orgId, async (tx) => {
    await assertWithinDailyLimit(tx, 'run');
    const created = await tx.skillRun.create({
      data: {
        orgId,
        skillKey: skill.key,
        status: 'running',
        mode,
        input: asJson(input),
        clientId,
        isCorrection,
      },
    });
    await logAudit(tx, {
      orgId,
      actorId: ENGINE_ACTOR,
      actorType: 'agent',
      action: 'skill.started',
      target: `${skill.key}:${created.id}`,
      detail: mode === 'simulation' ? { mode } : undefined,
    });
    return created;
  });

  if (drive === 'one_step') {
    return advanceRunOnce(orgId, run.id);
  }
  return driveRun(orgId, run.id);
}

/**
 * Public durable continue/resume: advance at most one step (or pause/fail).
 * Idempotent under double-delivery via claim lease + unique (run_id, idx).
 */
export async function continueRun(orgId: string, runId: string): Promise<RunHandle> {
  return advanceRunOnce(orgId, runId);
}

/**
 * Keep advancing while the run is advanceable (running/approved), until a
 * terminal status or awaiting_approval. Caps iterations as a safety bound.
 */
export async function driveRun(
  orgId: string,
  runId: string,
  maxSteps = 64,
): Promise<RunHandle> {
  let handle: RunHandle = { runId, status: 'running' };
  for (let i = 0; i < maxSteps; i++) {
    handle = await advanceRunOnce(orgId, runId);
    if (!isAdvanceable(handle.status)) {
      return handle;
    }
  }
  return handle;
}

/**
 * Approve the pending approval of a paused run (four-eyes: `decidedBy` is the
 * human who signed off) and resume until the next gate or terminal.
 */
export async function approve(
  orgId: string,
  runId: string,
  decidedBy: string,
  opts: { drive?: DriveMode } = {},
): Promise<RunHandle> {
  await decide(orgId, runId, decidedBy, 'approved');
  const drive = opts.drive ?? 'to_terminal';
  if (drive === 'one_step') {
    return advanceRunOnce(orgId, runId);
  }
  return driveRun(orgId, runId);
}

/**
 * Reject the pending approval: the run ends as `rejected`; the gated acting
 * step is never executed.
 */
export async function reject(
  orgId: string,
  runId: string,
  decidedBy: string,
): Promise<RunHandle> {
  await decide(orgId, runId, decidedBy, 'rejected');
  return { runId, status: 'rejected' };
}

// -----------------------------------------------------------------------------

/** Shared approve/reject transition: validates state, updates approval + run,
 * writes the human audit entry. */
async function decide(
  orgId: string,
  runId: string,
  decidedBy: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  if (!decidedBy.trim()) throw new Error('decide: decidedBy (the human) is required.');

  await withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== 'awaiting_approval') {
      throw new Error(`decide: run ${runId} is ${run.status}, not awaiting_approval.`);
    }
    const approval = await tx.approval.findFirstOrThrow({
      where: { runId, status: 'pending' },
    });

    if (approval.requiredRole) {
      const deciderRole = await getMemberRole(tx, decidedBy);
      if (!deciderRole || !roleSatisfies(deciderRole, approval.requiredRole)) {
        throw new Error(
          `decide: ${JSON.stringify(decidedBy)} (role: ${deciderRole ?? 'none'}) may not decide ` +
            `this approval — required: ${approval.requiredRole} (or admin).`,
        );
      }
    }

    await tx.approval.update({
      where: { id: approval.id },
      data: { status: decision, decidedBy, decidedAt: new Date() },
    });
    await tx.skillRun.update({
      where: { id: runId },
      data: {
        status: decision,
        // Free any stale claim so resume can take the lease.
        claimToken: null,
        claimUntil: null,
      },
    });
    await logAudit(tx, {
      orgId,
      actorId: decidedBy,
      actorType: 'human',
      action: `approval.${decision}`,
      target: `${run.skillKey}:${runId}`,
      detail:
        approval.stepIdx != null
          ? { stepIdx: approval.stepIdx, stepName: approval.stepName }
          : undefined,
    });
  });
}

interface GateVerdict {
  cleared: boolean;
  reason: string;
  /** Role the resulting approval demands; null = no policy (pre-policy behavior). */
  requiredRole: Role | null;
}

/** The skill's own (pre-policy) gate: guardrail verdict, failing closed for
 * money skills without a guardrail. */
function skillDefaultGate(skill: SkillDef, input: SkillJson): { cleared: boolean; reason: string } {
  if (!skill.guardrail) {
    if (skill.handlesMoney) {
      return { cleared: false, reason: 'handlesMoney without a guardrail — approval required' };
    }
    return { cleared: true, reason: 'no guardrail defined' };
  }
  const verdict = skill.guardrail(input);
  if (verdict.triggered) {
    return { cleared: false, reason: verdict.reason ?? 'Guardrail triggered — approval required' };
  }
  return { cleared: true, reason: 'guardrail not triggered' };
}

/**
 * True when the acting step at `stepIdx` may run.
 * Resolution: approved approval FOR THIS STEP (or legacy null-stepIdx) →
 * tenant policy → skill default.
 */
async function actingStepCleared(
  orgId: string,
  skill: SkillDef,
  runId: string,
  input: SkillJson,
  stepIdx: number,
): Promise<GateVerdict> {
  const { approvedForStep, legacyGlobalApproved, policy } = await withTenant(orgId, async (tx) => {
    const approvedForStep = await tx.approval.findFirst({
      where: { runId, status: 'approved', stepIdx },
    });
    // Pre-0030 rows: step_idx NULL. Keep old "any approved clears all" only for
    // those legacy rows so existing DBs do not brick mid-flight runs.
    const legacyGlobalApproved = await tx.approval.findFirst({
      where: { runId, status: 'approved', stepIdx: null },
    });
    const policy = await tx.approvalPolicy.findUnique({
      where: { orgId_skillKey: { orgId, skillKey: skill.key } },
    });
    return { approvedForStep, legacyGlobalApproved, policy };
  });

  if (approvedForStep) {
    return {
      cleared: true,
      reason: `approved by human for step ${stepIdx}`,
      requiredRole: null,
    };
  }
  if (legacyGlobalApproved) {
    return { cleared: true, reason: 'approved by human (legacy run-global)', requiredRole: null };
  }

  if (policy) {
    const requiredRole: Role = policy.approverRole ?? 'lead';

    if (policy.mode === 'always') {
      return { cleared: false, reason: 'Policy: approval always required', requiredRole };
    }

    if (policy.mode === 'threshold') {
      const threshold = policy.thresholdAmount ? policy.thresholdAmount.toNumber() : null;
      const amount = skill.amountOf ? skill.amountOf(input) : null;
      if (threshold === null || amount === null) {
        return {
          cleared: false,
          reason: 'Policy threshold: amount/threshold not determinable — approval required',
          requiredRole,
        };
      }
      if (amount >= threshold) {
        return {
          cleared: false,
          reason: `Amount ${amount.toFixed(2)} EUR ≥ threshold ${threshold.toFixed(2)} EUR — approval required`,
          requiredRole,
        };
      }
      return {
        cleared: true,
        reason: `Amount below policy threshold ${threshold.toFixed(2)} EUR`,
        requiredRole,
      };
    }

    // mode === 'never'
    if (!skill.handlesMoney) {
      return { cleared: true, reason: 'Policy: no approval needed', requiredRole };
    }
    await withTenant(orgId, (tx) =>
      logAudit(tx, {
        orgId,
        actorId: ENGINE_ACTOR,
        actorType: 'agent',
        action: 'policy.overridden_failsafe',
        target: `${skill.key}:${runId}`,
        detail: {
          policyMode: 'never',
          reason: 'handlesMoney skill: the approval requirement cannot be disabled',
        },
      }),
    );
    const fallback = skillDefaultGate(skill, input);
    return { ...fallback, requiredRole };
  }

  return { ...skillDefaultGate(skill, input), requiredRole: null };
}

interface ClaimedAdvance {
  skill: SkillDef;
  input: SkillJson;
  mode: SkillRunMode;
  nextIdx: number;
  state: Record<string, SkillJson>;
  stepAttempts: number;
  claimToken: string;
}

type ClaimResult =
  | { kind: 'terminal'; status: SkillRun['status'] }
  | { kind: 'busy'; status: SkillRun['status'] }
  | { kind: 'claimed'; data: ClaimedAdvance };

async function claimAdvance(orgId: string, runId: string): Promise<ClaimResult> {
  const claimToken = randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);

  return withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.findUniqueOrThrow({ where: { id: runId } });

    if (!isAdvanceable(run.status)) {
      return { kind: 'terminal' as const, status: run.status };
    }

    if (run.claimUntil && run.claimUntil > now) {
      // Another worker holds the lease — do not advance (idempotent no-op).
      return { kind: 'busy' as const, status: run.status };
    }

    await tx.skillRun.update({
      where: { id: runId },
      data: { claimToken, claimUntil: leaseUntil },
    });

    const doneSteps = await tx.skillStep.findMany({
      where: { runId, status: 'done' },
      orderBy: { idx: 'asc' },
    });
    const state: Record<string, SkillJson> = {};
    for (const s of doneSteps) state[s.name] = (s.detail ?? {}) as SkillJson;

    // Contiguous done steps 0..n-1; next idx is the count of done steps.
    // Unique (run_id, idx) prevents double-done under races.
    const nextIdx = doneSteps.length;

    return {
      kind: 'claimed' as const,
      data: {
        skill: getSkill(run.skillKey),
        input: run.input as SkillJson,
        mode: run.mode,
        nextIdx,
        state,
        stepAttempts: run.stepAttempts,
        claimToken,
      },
    };
  });
}

async function releaseClaim(
  orgId: string,
  runId: string,
  claimToken: string,
  patch: {
    status?: SkillRun['status'];
    stepAttempts?: number;
    result?: SkillJson;
  } = {},
): Promise<void> {
  await withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.findUnique({ where: { id: runId } });
    if (!run || run.claimToken !== claimToken) return;
    await tx.skillRun.update({
      where: { id: runId },
      data: {
        claimToken: null,
        claimUntil: null,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.stepAttempts !== undefined ? { stepAttempts: patch.stepAttempts } : {}),
        ...(patch.result !== undefined ? { result: asJson(patch.result) } : {}),
      },
    });
  });
}

/**
 * Advance at most ONE step (or pause at gate / fail / complete if no steps left).
 * This is the durable unit of work used by continueRun, startRun(one_step), and
 * each iteration of driveRun.
 */
export async function advanceRunOnce(orgId: string, runId: string): Promise<RunHandle> {
  const claimed = await claimAdvance(orgId, runId);
  if (claimed.kind === 'terminal' || claimed.kind === 'busy') {
    return { runId, status: claimed.status };
  }

  const { skill, input, mode, nextIdx, state, stepAttempts, claimToken } = claimed.data;

  // All steps done but run not completed yet (e.g. after last step write race).
  if (nextIdx >= skill.steps.length) {
    await finalizeCompleted(orgId, skill, runId, state, mode, claimToken);
    return { runId, status: 'completed' };
  }

  const step = skill.steps[nextIdx]!;

  if (step.acts) {
    const gate = await actingStepCleared(orgId, skill, runId, input, nextIdx);

    if (mode === 'simulation') {
      await recordSimulatedStep(orgId, skill, runId, nextIdx, step, input, state, gate);
      const isLast = nextIdx === skill.steps.length - 1;
      if (isLast) {
        await finalizeCompleted(orgId, skill, runId, state, mode, claimToken);
        return { runId, status: 'completed' };
      }
      await releaseClaim(orgId, runId, claimToken, { status: 'running', stepAttempts: 0 });
      return { runId, status: 'running' };
    }

    if (!gate.cleared) {
      await withTenant(orgId, async (tx) => {
        const run = await tx.skillRun.findUnique({ where: { id: runId } });
        if (!run || run.claimToken !== claimToken) return;
        // Idempotent pause: if already awaiting with a pending approval for this
        // step, just release claim.
        const existing = await tx.approval.findFirst({
          where: { runId, status: 'pending', stepIdx: nextIdx },
        });
        if (!existing) {
          await tx.approval.create({
            data: {
              orgId,
              runId,
              reason: gate.reason,
              status: 'pending',
              requiredRole: gate.requiredRole,
              stepIdx: nextIdx,
              stepName: step.name,
            },
          });
          await logAudit(tx, {
            orgId,
            actorId: ENGINE_ACTOR,
            actorType: 'agent',
            action: 'guardrail.triggered',
            target: `${skill.key}:${runId}: ${gate.reason}`,
            detail: { stepIdx: nextIdx, stepName: step.name },
          });
        }
        await tx.skillRun.update({
          where: { id: runId },
          data: {
            status: 'awaiting_approval',
            claimToken: null,
            claimUntil: null,
          },
        });
      });
      await notifyApprovalRequested({
        orgId,
        runId,
        skillKey: skill.key,
        skillTitle: skill.title,
        reason: gate.reason,
      });
      return { runId, status: 'awaiting_approval' };
    }
  }

  try {
    const prepared = step.prepare
      ? await step.prepare({ orgId, runId, input, state })
      : undefined;

    await withTenant(orgId, async (tx) => {
      const run = await tx.skillRun.findUnique({ where: { id: runId } });
      if (!run || run.claimToken !== claimToken) {
        throw new Error('advanceRunOnce: claim lost before step write');
      }
      // Idempotent: if this idx is already done (double-delivery after success),
      // skip the effect.
      const already = await tx.skillStep.findFirst({
        where: { runId, idx: nextIdx, status: 'done' },
      });
      if (already) {
        state[step.name] = (already.detail ?? {}) as SkillJson;
      } else {
        const detail = await step.run({ orgId, tx, input, state, prepared });
        state[step.name] = detail;
        await tx.skillStep.create({
          data: {
            orgId,
            runId,
            idx: nextIdx,
            name: step.name,
            status: 'done',
            detail: asJson(detail),
          },
        });
        await logAudit(tx, {
          orgId,
          actorId: ENGINE_ACTOR,
          actorType: 'agent',
          action: 'skill.step_completed',
          target: `${skill.key}:${step.name}`,
        });
      }
    });
  } catch (err) {
    // Claim-lost after concurrent winner wrote the step: treat as success path.
    if (err instanceof Error && /claim lost/i.test(err.message)) {
      const status = await withTenant(orgId, async (tx) => {
        const r = await tx.skillRun.findUniqueOrThrow({ where: { id: runId } });
        return r.status;
      });
      return { runId, status };
    }

    // Unique violation on (run_id, idx) ⇒ peer already wrote done — re-read.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const status = await withTenant(orgId, async (tx) => {
        const r = await tx.skillRun.findUniqueOrThrow({ where: { id: runId } });
        return r.status;
      });
      await releaseClaim(orgId, runId, claimToken).catch(() => {});
      return { runId, status };
    }

    const attempts = stepAttempts + 1;
    if (isRetriableStepError(err) && attempts < MAX_STEP_ATTEMPTS) {
      await withTenant(orgId, async (tx) => {
        const run = await tx.skillRun.findUnique({ where: { id: runId } });
        if (!run || run.claimToken !== claimToken) return;
        await logAudit(tx, {
          orgId,
          actorId: ENGINE_ACTOR,
          actorType: 'agent',
          action: 'skill.step_retry',
          target: `${skill.key}:${step.name}`,
          detail: {
            attempt: attempts,
            maxAttempts: MAX_STEP_ATTEMPTS,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        await tx.skillRun.update({
          where: { id: runId },
          data: {
            status: 'running',
            stepAttempts: attempts,
            claimToken: null,
            claimUntil: null,
          },
        });
      });
      return { runId, status: 'running' };
    }

    await withTenant(orgId, async (tx) => {
      const run = await tx.skillRun.findUnique({ where: { id: runId } });
      if (!run || run.claimToken !== claimToken) return;
      // Avoid duplicate failed rows on final double-delivery.
      const existing = await tx.skillStep.findFirst({ where: { runId, idx: nextIdx } });
      if (!existing) {
        await tx.skillStep.create({
          data: {
            orgId,
            runId,
            idx: nextIdx,
            name: step.name,
            status: 'failed',
            detail: asJson({ error: err instanceof Error ? err.message : String(err) }),
          },
        });
      }
      await tx.skillRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          claimToken: null,
          claimUntil: null,
        },
      });
      await logAudit(tx, {
        orgId,
        actorId: ENGINE_ACTOR,
        actorType: 'agent',
        action: 'skill.failed',
        target: `${skill.key}:${step.name}`,
        detail: mode === 'simulation' ? { mode } : undefined,
      });
    });
    return { runId, status: 'failed' };
  }

  const isLast = nextIdx === skill.steps.length - 1;
  if (isLast) {
    await finalizeCompleted(orgId, skill, runId, state, mode, claimToken);
    return { runId, status: 'completed' };
  }

  await releaseClaim(orgId, runId, claimToken, { status: 'running', stepAttempts: 0 });
  return { runId, status: 'running' };
}

async function finalizeCompleted(
  orgId: string,
  skill: SkillDef,
  runId: string,
  state: Record<string, SkillJson>,
  mode: SkillRunMode,
  claimToken: string,
): Promise<void> {
  if (mode === 'live') {
    try {
      await evaluateDeliverableCriteria(orgId, skill.key, runId, state);
    } catch (err) {
      await withTenant(orgId, (tx) =>
        logAudit(tx, {
          orgId,
          actorId: ENGINE_ACTOR,
          actorType: 'agent',
          action: 'loop.evaluation_failed',
          target: `${skill.key}:${runId}`,
          detail: { error: err instanceof Error ? err.message : String(err) },
        }),
      ).catch(() => {});
    }
  }

  await withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.findUnique({ where: { id: runId } });
    if (run?.status === 'completed') return;
    // Only the claim holder (or a reclaim after lease expiry) should complete.
    if (run && run.claimToken && run.claimToken !== claimToken) return;
    await tx.skillRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        result: asJson(state),
        claimToken: null,
        claimUntil: null,
        stepAttempts: 0,
      },
    });
    await logAudit(tx, {
      orgId,
      actorId: ENGINE_ACTOR,
      actorType: 'agent',
      action: 'skill.completed',
      target: `${skill.key}:${runId}`,
      detail: mode === 'simulation' ? { mode } : undefined,
    });
  });
}

/**
 * DRY-RUN only: record an acting step as SIMULATED — evaluated, never executed.
 */
async function recordSimulatedStep(
  orgId: string,
  skill: SkillDef,
  runId: string,
  idx: number,
  step: StepDef,
  input: SkillJson,
  state: Record<string, SkillJson>,
  gate: GateVerdict,
): Promise<void> {
  await withTenant(orgId, async (tx) => {
    const already = await tx.skillStep.findFirst({
      where: { runId, idx, status: 'done' },
    });
    if (already) {
      state[step.name] = (already.detail ?? {}) as SkillJson;
      return;
    }
    let effectPreview: SkillJson | null = null;
    if (step.describeEffect) {
      try {
        effectPreview = await step.describeEffect({ orgId, tx, input, state });
      } catch (err) {
        effectPreview = { previewError: err instanceof Error ? err.message : String(err) };
      }
    }
    const detail: SkillJson = {
      simulated: true,
      acts: true,
      wouldRequireApproval: !gate.cleared,
      gateReason: gate.reason,
      ...(gate.requiredRole ? { wouldRequireRole: gate.requiredRole } : {}),
      ...(effectPreview ? { effectPreview } : {}),
    };
    state[step.name] = detail;
    await tx.skillStep.create({
      data: { orgId, runId, idx, name: step.name, status: 'done', detail: asJson(detail) },
    });
    await logAudit(tx, {
      orgId,
      actorId: ENGINE_ACTOR,
      actorType: 'agent',
      action: 'skill.simulated_act',
      target: `${skill.key}:${step.name}`,
      detail: {
        mode: 'simulation',
        wouldRequireApproval: !gate.cleared,
        reason: gate.reason,
      },
    });
  });
}
