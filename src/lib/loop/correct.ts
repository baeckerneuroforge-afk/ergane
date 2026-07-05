// The correction trigger — the ONE place a flag's proposal becomes a real run.
//
// A human triggers this (via /api/loop/correct from the /flags button, or the
// Slack "start correction" button). It does the narrowest possible thing: load
// the ORIGINAL run's stored input and re-run the SAME skill with it via the
// existing startRun(). That is the whole "correction": a faithful replay.
//
// THE SAFETY PROPERTY (plan §4, the hard grenze): the loop can PROPOSE and, on a
// human click, START a correction — but it NEVER FREIGEBEN (approves) one. This
// module only calls startRun(). startRun() runs the skill through the SAME
// approval machinery as any run: guardrail + tenant approval policy decide
// whether it pauses at awaiting_approval for a human. We do not call approve()
// here, and we never bypass the gate — a corrected run that needs approval waits
// for a human exactly like a hand-started one.
//
// Tenant + engine rules are unchanged: startRun() opens its own withTenant tx
// and honours the 15s / no-LLM-in-tx / prepare-hook contract. We add nothing to
// that mechanic.

import { logAudit } from '../audit';
import { getSkill, startRun, type RunHandle } from '../skills';
import type { SkillJson } from '../skills';
import { withTenant } from '../tenant';
import { resolveAutonomyContext } from './settings';

export const CORRECTION_ACTOR = 'loop-engine';
/** Audit action when a HUMAN triggered the correction (button / Slack). */
export const CORRECTION_ACTION = 'flag.correction_requested';
/** Audit action when the LOOP auto-started the correction (Schritt E, 'autonomous'). */
export const AUTO_CORRECTION_ACTION = 'loop.auto_correction_started';

/**
 * Who triggered a correction. 'human' = a person clicked (button / Slack) →
 * audited as flag.correction_requested with actorType 'human'. 'loop' = the loop
 * auto-started it in 'autonomous' mode → audited as loop.auto_correction_started
 * with actorType 'agent'. Either way the SAME run-start + gate logic runs; only
 * the audit trail differs. The loop can start, never approve.
 */
export type CorrectionTrigger = 'human' | 'loop';

/**
 * A correction that failed because of the CLIENT-supplied reference (unknown
 * skill, foreign/missing source run, mismatched skill) — as opposed to an
 * internal error. Callers turn this into a 4xx / ephemeral message; its
 * `message` is safe to show (it names the bad ref, never tenant data).
 */
export class CorrectionBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionBadRequestError';
  }
}

export interface StartCorrectionInput {
  orgId: string;
  /**
   * WHO triggered it — the human's id (Clerk user id, or the resolved membership
   * user id for a Slack click), or the loop actor id ('loop-engine') for an
   * auto-start. Recorded in the audit trail. This is NOT an approval: it only
   * says who asked for the re-run.
   */
  actorUserId: string;
  /** The skill to re-run (from the flag's correction ref). Must be a known skill. */
  skillKey: string;
  /** The original run whose input is replayed. Its input + client are reused. */
  sourceRunId: string;
  /**
   * Human click (default) vs. loop auto-start. Switches the audit action +
   * actorType; the run-start + gate logic is identical either way.
   */
  trigger?: CorrectionTrigger;
}

export interface StartCorrectionResult {
  runId: string;
  status: RunHandle['status'];
  /** True when the re-run paused for approval — the normal, expected outcome for
   * a gated skill. false = it completed/failed without needing approval. */
  awaitingApproval: boolean;
}

/**
 * Start a correction run from a flag's re-run pointer. Resolves the original
 * run inside a short tenant tx (RLS scopes it — a foreign sourceRunId is simply
 * "not found"), then hands off to startRun() OUTSIDE that tx. Writes an audit
 * 'flag.correction_requested' with actorType 'human' (a human asked for it).
 *
 * Throws for an unknown skill or a source run that isn't this tenant's — callers
 * (the route / Slack handler) turn that into a 4xx / ephemeral error.
 */
export async function startCorrectionRun(
  input: StartCorrectionInput,
): Promise<StartCorrectionResult> {
  const { orgId, actorUserId, skillKey, sourceRunId } = input;
  const trigger: CorrectionTrigger = input.trigger ?? 'human';
  const isLoop = trigger === 'loop';
  if (!actorUserId.trim()) throw new Error('startCorrectionRun: actorUserId is required.');

  // Validate the skill up front — never start an unknown skill. A bad skillKey
  // came from the client, so it is a bad-request, not an internal error.
  let skill;
  try {
    skill = getSkill(skillKey);
  } catch {
    throw new CorrectionBadRequestError(`Unknown skill: ${JSON.stringify(skillKey)}.`);
  }

  // Load the original run + the tenant's CURRENT autonomy in one short RLS-scoped
  // tx. A foreign or missing runId is "not found" here (RLS scopes the lookup to
  // the tenant), so we can never replay another tenant's run — turn it into a
  // bad-request.
  const { source, autonomy } = await withTenant(orgId, async (tx) => ({
    source: await tx.skillRun.findUnique({
      where: { id: sourceRunId },
      select: { skillKey: true, input: true, clientId: true },
    }),
    autonomy: await resolveAutonomyContext(tx, orgId),
  }));
  if (!source) {
    throw new CorrectionBadRequestError(`Source run not found: ${JSON.stringify(sourceRunId)}.`);
  }
  // Autonomy gate at TRIGGER time (defence in depth, not just when the flag was
  // built). A human trigger needs 'suggest' or 'autonomous' (a stale button after
  // a revert to 'report' must not start). A LOOP trigger needs 'autonomous'
  // specifically — this is the second, independent assertion that only
  // 'autonomous' auto-starts, so even a mis-wired loop caller can never start a
  // correction on a 'suggest'/'report' tenant.
  const allowed = isLoop ? autonomy.autoStart : autonomy.suggest;
  if (!allowed) {
    throw new CorrectionBadRequestError(
      `Corrections are disabled for this organization (autonomy level is ${JSON.stringify(autonomy.autonomy)}).`,
    );
  }
  // Defence in depth: the re-run must be the SAME skill the flag pointed at.
  if (source.skillKey !== skill.key) {
    throw new CorrectionBadRequestError(
      `Source run ${JSON.stringify(sourceRunId)} is skill ${JSON.stringify(source.skillKey)}, ` +
        `not ${JSON.stringify(skill.key)}.`,
    );
  }

  const replayInput = (source.input ?? {}) as SkillJson;

  // Hand off to the normal engine. startRun opens its OWN withTenant tx (we are
  // outside any tx here) and routes the run through guardrail + approval policy
  // → it may pause at awaiting_approval. We never touch that outcome.
  // isCorrection: true marks the run AT CREATION so, even if it completes
  // synchronously and re-fails its criteria, the anti-loop guard recognises it
  // (via skill_runs.is_correction) and never auto-corrects it again.
  const handle = await startRun(orgId, skill.key, replayInput, {
    clientId: source.clientId,
    isCorrection: true,
  });

  // Audit the trigger AFTER the run exists. For a human it is
  // flag.correction_requested (actorType 'human'); for a loop auto-start it is
  // loop.auto_correction_started (actorType 'agent', actorId 'loop-engine'). The
  // target carries the STARTED run's id (`skillKey:runId`) — the /flags + run UI
  // read it to show "auto-started by the loop". (The anti-loop guard does NOT
  // rely on this audit; it reads skill_runs.is_correction, set at creation, which
  // is why a synchronously-completing correction run is stopped correctly.) The
  // approval decision, if any, gets its own approval.* audit later.
  await withTenant(orgId, (tx) =>
    logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: isLoop ? 'agent' : 'human',
      action: isLoop ? AUTO_CORRECTION_ACTION : CORRECTION_ACTION,
      target: `${skill.key}:${handle.runId}`,
      detail: {
        sourceRunId,
        clientId: source.clientId,
        resultStatus: handle.status,
        trigger,
      },
    }),
  );

  return {
    runId: handle.runId,
    status: handle.status,
    awaitingApproval: handle.status === 'awaiting_approval',
  };
}
