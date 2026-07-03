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
import { Prisma, type Role, type SkillRun } from '@prisma/client';
import { logAudit } from '../audit';
import { getMemberRole, roleSatisfies } from '../policies';
import { withTenant } from '../tenant';
import { getSkill } from './catalog';
import { notifyApprovalRequested } from './notify';
import type { SkillDef, SkillJson } from './types';

export interface RunHandle {
  runId: string;
  status: SkillRun['status'];
}

const ENGINE_ACTOR = 'skill-engine';

function asJson(value: SkillJson): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Start a new run of `skillKey` for the tenant and execute steps until the run
 * completes, fails, or pauses at the guardrail (awaiting_approval).
 */
export async function startRun(
  orgId: string,
  skillKey: string,
  input: SkillJson,
): Promise<RunHandle> {
  const skill = getSkill(skillKey);

  const run = await withTenant(orgId, async (tx) => {
    const created = await tx.skillRun.create({
      data: { orgId, skillKey: skill.key, status: 'running', input: asJson(input) },
    });
    await logAudit(tx, {
      orgId,
      actorId: ENGINE_ACTOR,
      actorType: 'agent',
      action: 'skill.started',
      target: `${skill.key}:${created.id}`,
    });
    return created;
  });

  return executeFrom(orgId, skill, run.id, input, 0, {});
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
  const { skill, input, doneCount, state } = await decide(orgId, runId, decidedBy, 'approved');
  return executeFrom(orgId, skill, runId, input, doneCount, state);
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
      return { cleared: false, reason: 'handlesMoney ohne Guardrail — Freigabe erforderlich' };
    }
    return { cleared: true, reason: 'no guardrail defined' };
  }
  const verdict = skill.guardrail(input);
  if (verdict.triggered) {
    return { cleared: false, reason: verdict.reason ?? 'Guardrail ausgelöst — Freigabe erforderlich' };
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
      return { cleared: false, reason: 'Policy: Freigabe immer erforderlich', requiredRole };
    }

    if (policy.mode === 'threshold') {
      const threshold = policy.thresholdAmount ? policy.thresholdAmount.toNumber() : null;
      const amount = skill.amountOf ? skill.amountOf(input) : null;
      // Fail closed: a threshold policy without a usable threshold or amount
      // behaves like 'always'.
      if (threshold === null || amount === null) {
        return {
          cleared: false,
          reason: 'Policy threshold: Betrag/Schwelle nicht bestimmbar — Freigabe erforderlich',
          requiredRole,
        };
      }
      if (amount >= threshold) {
        return {
          cleared: false,
          reason: `Betrag ${amount.toFixed(2)} € ≥ Schwelle ${threshold.toFixed(2)} € — Freigabe erforderlich`,
          requiredRole,
        };
      }
      return { cleared: true, reason: `Betrag unter Policy-Schwelle ${threshold.toFixed(2)} €`, requiredRole };
    }

    // mode === 'never'
    if (!skill.handlesMoney) {
      return { cleared: true, reason: 'Policy: keine Freigabe nötig', requiredRole };
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
          reason: 'handlesMoney-Skill: Freigabe-Pflicht ist nicht abschaltbar',
        },
      }),
    );
    const fallback = skillDefaultGate(skill, input);
    return { ...fallback, requiredRole };
  }

  // No policy: pre-policy behavior, approvals carry no required_role.
  return { ...skillDefaultGate(skill, input), requiredRole: null };
}

/** Execute steps starting at `startIdx`; pauses at the guardrail, completes,
 * or fails. Each step runs in its own withTenant transaction. */
async function executeFrom(
  orgId: string,
  skill: SkillDef,
  runId: string,
  input: SkillJson,
  startIdx: number,
  state: Record<string, SkillJson>,
): Promise<RunHandle> {
  for (let idx = startIdx; idx < skill.steps.length; idx++) {
    const step = skill.steps[idx];

    if (step.acts) {
      const gate = await actingStepCleared(orgId, skill, runId, input);
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
      await withTenant(orgId, async (tx) => {
        // Step effect + step row + audit entry: one atomic transaction.
        const detail = await step.run({ orgId, tx, input, state });
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
    });
  });
  return { runId, status: 'completed' };
}
