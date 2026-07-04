// Skill execution engine: guardrail → human approval → audit, per tenant.
//
// Lifecycle of a run:
//
//   startRun()            running ──(steps execute, one tx each)──▶ completed
//                            │
//                            │ acting step + guardrail triggered
//                            ▼
//                       awaiting_approval   ← NOTHING acts while paused
//                        │           │
//              approve() │           │ reject()
//                        ▼           ▼
//                     approved     rejected  (acting step never ran)
//                        │
//                        └─(remaining steps)──▶ completed
//
// Invariants:
//   - Every DB access happens inside withTenant(orgId, …) — RLS applies, no
//     tenant context ⇒ zero effect (fail closed).
//   - Every state change writes to the append-only audit_log: skill.started,
//     skill.step_completed, guardrail.triggered, approval.approved,
//     approval.rejected, skill.completed, skill.failed. Engine actions are
//     actor_type 'agent'; approve/reject are 'human' (decided_by).
//   - Each step is atomic: step effect + skill_step row + audit entry share one
//     transaction.
//   - An acting step of a handlesMoney skill NEVER executes unless either the
//     guardrail says "not triggered" or a human approval exists. A money skill
//     without a guardrail fails closed (always requires approval).
//
// Approval policies (Phase 4, approval_policies table) configure WHEN a human
// is needed — per tenant, per skill. Resolution order in the gate:
//   1. an approved approval for this run       → cleared (resume path)
//   2. tenant policy 'always'                  → approval required
//   3. tenant policy 'threshold'               → required iff amount ≥ threshold
//                                                (unknown amount: fail closed)
//   4. tenant policy 'never'                   → honored ONLY for skills without
//      money effects; for handlesMoney skills it is overridden at runtime
//      (audit 'policy.overridden_failsafe') and the skill's own guardrail
//      applies — this non-disablability is deliberate and tested
//   5. no policy                               → pre-policy behavior (skill
//      guardrail; handlesMoney without guardrail ⇒ always approval)
// A policy-produced approval stores required_role (policy.approver_role,
// default 'lead'); decide() then verifies the decider's membership holds that
// role (admin/owner always qualify). Approvals without required_role (no-policy
// case) keep the pre-policy behavior. Policies act only WITHIN the tenant —
// they are read through withTenant(), so tenant B's policies can never
// influence tenant A.
//
// Dry-run (mode='simulation', "Probelauf"): a run started with mode 'simulation'
// walks EVERY step exactly like a live run — retrieval, context building,
// guardrail evaluation and the approval-need check all run and are recorded —
// but each ACTING step is SIMULATED instead of executed (recordSimulatedStep):
// no effect fires and the run NEVER pauses in awaiting_approval. Instead the
// simulated step captures what WOULD happen, including whether an approval
// would be required and why (so the money failsafe stays visible). A simulation
// therefore always ends in completed/failed, never awaiting_approval, and is
// marked mode='simulation' on the run + audit so it is never mistaken for — or
// counted as — a real execution.
import { Prisma, type Role, type SkillRun, type SkillRunMode } from '@prisma/client';
import { logAudit } from '../audit';
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

function asJson(value: SkillJson): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
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
}

/**
 * Start a new run of `skillKey` for the tenant and execute steps until the run
 * completes, fails, or pauses at the guardrail (awaiting_approval).
 *
 * In a dry-run (opts.mode='simulation') acting steps never execute and the run
 * never pauses: it walks every step, records what WOULD happen (including
 * whether an approval would be required, and why), and ends completed/failed.
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

  const run = await withTenant(orgId, async (tx) => {
    // Kostenschutz: Tageslimit für Skill-Läufe (weiches Limit, siehe limits.ts).
    // Ein Probelauf zählt bewusst mit — er verursacht dieselben Lese-/LLM-Kosten
    // wie ein Live-Lauf; nur die WIRKENDEN Schritte entfallen.
    await assertWithinDailyLimit(tx, 'run');
    const created = await tx.skillRun.create({
      data: { orgId, skillKey: skill.key, status: 'running', mode, input: asJson(input), clientId },
    });
    await logAudit(tx, {
      orgId,
      actorId: ENGINE_ACTOR,
      actorType: 'agent',
      action: 'skill.started',
      target: `${skill.key}:${created.id}`,
      // Live bleibt unverändert (kein detail); ein Probelauf ist im Audit klar
      // als solcher markiert (mode='simulation').
      detail: mode === 'simulation' ? { mode } : undefined,
    });
    return created;
  });

  return executeFrom(orgId, skill, run.id, input, 0, {}, mode);
}

/**
 * Approve the pending approval of a paused run (four-eyes: `decidedBy` is the
 * human who signed off) and resume execution until completed/failed.
 */
export async function approve(
  orgId: string,
  runId: string,
  decidedBy: string,
): Promise<RunHandle> {
  const { skill, input, doneCount, state, mode } = await decide(orgId, runId, decidedBy, 'approved');
  return executeFrom(orgId, skill, runId, input, doneCount, state, mode);
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
 * writes the human audit entry, and returns what a resume needs. */
async function decide(
  orgId: string,
  runId: string,
  decidedBy: string,
  decision: 'approved' | 'rejected',
) {
  if (!decidedBy.trim()) throw new Error('decide: decidedBy (the human) is required.');

  return withTenant(orgId, async (tx) => {
    // RLS already scopes to the tenant; findUniqueOrThrow on a foreign runId
    // therefore fails with "not found" rather than leaking anything.
    const run = await tx.skillRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== 'awaiting_approval') {
      throw new Error(`decide: run ${runId} is ${run.status}, not awaiting_approval.`);
    }
    const approval = await tx.approval.findFirstOrThrow({
      where: { runId, status: 'pending' },
    });

    // Role gate (four-eyes): a policy-produced approval names the role that may
    // decide it. Fail-closed: no membership ⇒ no decision. Approvals without
    // required_role (created without a policy) keep the pre-policy behavior.
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
    await tx.skillRun.update({ where: { id: runId }, data: { status: decision } });
    await logAudit(tx, {
      orgId,
      actorId: decidedBy,
      actorType: 'human',
      action: `approval.${decision}`,
      target: `${run.skillKey}:${runId}`,
    });

    const doneSteps = await tx.skillStep.findMany({
      where: { runId, status: 'done' },
      orderBy: { idx: 'asc' },
    });
    const state: Record<string, SkillJson> = {};
    for (const s of doneSteps) state[s.name] = (s.detail ?? {}) as SkillJson;

    return {
      skill: getSkill(run.skillKey),
      input: run.input as SkillJson,
      doneCount: doneSteps.length,
      state,
      // A simulation never reaches awaiting_approval, so a resumed run is always
      // 'live' — reading it from the row keeps that correct rather than assumed.
      mode: run.mode,
    };
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

/** True when the acting step may run. Resolution order: approved approval →
 * tenant approval policy (always/threshold/never-with-failsafe) → skill default.
 * Fail-closed at every branch. */
async function actingStepCleared(
  orgId: string,
  skill: SkillDef,
  runId: string,
  input: SkillJson,
): Promise<GateVerdict> {
  const { approved, policy } = await withTenant(orgId, async (tx) => ({
    approved: await tx.approval.findFirst({ where: { runId, status: 'approved' } }),
    policy: await tx.approvalPolicy.findUnique({
      where: { orgId_skillKey: { orgId, skillKey: skill.key } },
    }),
  }));
  if (approved) {
    return { cleared: true, reason: 'approved by human', requiredRole: null };
  }

  if (policy) {
    const requiredRole: Role = policy.approverRole ?? 'lead';

    if (policy.mode === 'always') {
      return { cleared: false, reason: 'Policy: approval always required', requiredRole };
    }

    if (policy.mode === 'threshold') {
      const threshold = policy.thresholdAmount ? policy.thresholdAmount.toNumber() : null;
      const amount = skill.amountOf ? skill.amountOf(input) : null;
      // Fail closed: a threshold policy without a usable threshold or amount
      // behaves like 'always'.
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
      return { cleared: true, reason: `Amount below policy threshold ${threshold.toFixed(2)} EUR`, requiredRole };
    }

    // mode === 'never'
    if (!skill.handlesMoney) {
      return { cleared: true, reason: 'Policy: no approval needed', requiredRole };
    }
    // FAILSAFE (deliberately non-disablable): 'never' on a money skill is
    // ignored at runtime — the skill's own guardrail applies instead. Audited.
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

  // No policy: pre-policy behavior, approvals carry no required_role.
  return { ...skillDefaultGate(skill, input), requiredRole: null };
}

/** Execute steps starting at `startIdx`; pauses at the guardrail (live only),
 * completes, or fails. Each step runs in its own withTenant transaction. In
 * mode='simulation' acting steps are simulated (recordSimulatedStep), the run
 * never pauses, and it always ends completed/failed. */
async function executeFrom(
  orgId: string,
  skill: SkillDef,
  runId: string,
  input: SkillJson,
  startIdx: number,
  state: Record<string, SkillJson>,
  mode: SkillRunMode,
): Promise<RunHandle> {
  for (let idx = startIdx; idx < skill.steps.length; idx++) {
    const step = skill.steps[idx];

    if (step.acts) {
      // Guardrail + approval-need are evaluated in BOTH modes — a dry-run must
      // hit exactly the gate a live run would (including the money failsafe).
      const gate = await actingStepCleared(orgId, skill, runId, input);

      if (mode === 'simulation') {
        // DRY-RUN: never execute the effect, never pause. Record what WOULD
        // happen (incl. whether approval would be required, and why) and move on.
        await recordSimulatedStep(orgId, skill, runId, idx, step, input, state, gate);
        continue;
      }

      if (!gate.cleared) {
        await withTenant(orgId, async (tx) => {
          await tx.skillRun.update({
            where: { id: runId },
            data: { status: 'awaiting_approval' },
          });
          await tx.approval.create({
            data: {
              orgId,
              runId,
              reason: gate.reason,
              status: 'pending',
              requiredRole: gate.requiredRole,
            },
          });
          await logAudit(tx, {
            orgId,
            actorId: ENGINE_ACTOR,
            actorType: 'agent',
            action: 'guardrail.triggered',
            target: `${skill.key}:${runId}: ${gate.reason}`,
          });
        });
        // NACH dem Commit: best-effort-Benachrichtigung (wirft nie — die
        // Freigabe existiert bereits, mit oder ohne Mail).
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
      // PRE-TRANSACTION PHASE (the non-negotiable rule): if the step declares a
      // prepare() hook, its expensive/slow work (an LLM or external tool call)
      // runs HERE, BEFORE withTenant() opens — never inside the 15s tenant
      // transaction. Exactly the answerQuestion pattern: costly call first, then
      // a SHORT transaction writes only the result atomically. Steps without
      // prepare() skip this entirely (prepared stays undefined).
      const prepared = step.prepare
        ? await step.prepare({ orgId, runId, input, state })
        : undefined;
      await withTenant(orgId, async (tx) => {
        // Step effect + step row + audit entry: one atomic transaction.
        const detail = await step.run({ orgId, tx, input, state, prepared });
        state[step.name] = detail;
        await tx.skillStep.create({
          data: { orgId, runId, idx, name: step.name, status: 'done', detail: asJson(detail) },
        });
        await logAudit(tx, {
          orgId,
          actorId: ENGINE_ACTOR,
          actorType: 'agent',
          action: 'skill.step_completed',
          target: `${skill.key}:${step.name}`,
        });
      });
    } catch (err) {
      await withTenant(orgId, async (tx) => {
        await tx.skillStep.create({
          data: {
            orgId,
            runId,
            idx,
            name: step.name,
            status: 'failed',
            detail: asJson({ error: err instanceof Error ? err.message : String(err) }),
          },
        });
        await tx.skillRun.update({ where: { id: runId }, data: { status: 'failed' } });
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
  }

  await withTenant(orgId, async (tx) => {
    await tx.skillRun.update({
      where: { id: runId },
      data: { status: 'completed', result: asJson(state) },
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
  return { runId, status: 'completed' };
}

/**
 * DRY-RUN only: record an acting step as SIMULATED — evaluated, never executed.
 * Captures the guardrail/approval verdict (would it require approval? why? which
 * role?) and, if the skill provides a `describeEffect`, a read-only preview of
 * what the effect WOULD do. Its own atomic transaction, like every other step;
 * `describeEffect` is best-effort so a broken preview can never turn a safe
 * dry-run into a failure. Never fires an effect and never creates an approval.
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
      // The heart of the "Probelauf": the SAME gate a live run would face.
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
