// Autonomous auto-correction (Schritt E) — the loop starts a correction ITSELF,
// without a human click, but ONLY at autonomy 'autonomous' and ONLY behind four
// brakes. The started run still goes through the normal approval gate: the loop
// STARTS a correction, it never APPROVES one.
//
// WHERE THIS RUNS (the non-negotiable rule): maybeAutoCorrect() is called AFTER
// the flag-writing transaction has committed — the same spot as notifyFlag, best
// -effort. It NEVER runs inside the short flag tx, and it NEVER throws (any
// failure is logged and swallowed; the flag already exists). The actual re-run
// reuses startCorrectionRun() from Schritt D — the SAME run-start + gate path a
// human click uses; no second path.
//
// THE FOUR BRAKES (plan §4 "die harte Grenze", §11 risks D/E):
//   1. Config       — only 'autonomous' auto-starts; the default 'report' and
//                     'suggest' never do (checked by the caller via ctx.autoStart,
//                     re-asserted in startCorrectionRun's autonomy gate).
//   2. Approval gate — the started run pauses at awaiting_approval for a human;
//                     the loop cannot approve.
//   3. Daily limit  — at most MAX_AUTO_CORRECTIONS_PER_DAY auto-starts per org per
//                     24h. At the limit: NO start, and a
//                     loop.auto_correction_limit_reached audit so a human sees
//                     something is pending.
//   4. Anti-loop    — a flag raised BY a correction run must not trigger another
//                     auto-correction (else run→flag→run→…). A correction run is
//                     marked STRUCTURALLY (skill_runs.is_correction, set at
//                     creation by startCorrectionRun) so that even a correction
//                     run which completes SYNCHRONOUSLY and re-fails its criteria
//                     is recognised the instant it self-evaluates — the audit
//                     trail is written too late to serve as this marker.

import { logAudit } from '../audit';
import { logError } from '../log';
import { withTenant, type Tx } from '../tenant';
import { AUTO_CORRECTION_ACTION, CORRECTION_ACTOR, startCorrectionRun } from './correct';
import { resolveAutonomyContext } from './settings';
import type { CorrectionRef } from './suggest';

/** Max automatic correction runs per org per rolling 24h (code constant, plan §11). */
export const MAX_AUTO_CORRECTIONS_PER_DAY = 3;

/** Rolling window the daily limit is counted over. */
export const AUTO_CORRECTION_WINDOW_HOURS = 24;

/** Audit written when the daily limit blocks an auto-start (a human should look). */
export const AUTO_CORRECTION_LIMIT_ACTION = 'loop.auto_correction_limit_reached';

/** Outcome of an auto-correction attempt (returned for logging/tests). */
export type AutoCorrectOutcome =
  | { kind: 'started'; runId: string }
  | { kind: 'skipped'; reason: 'not_autonomous' | 'source_is_correction' | 'limit_reached' | 'error' };

/**
 * True when `sourceRunId` is ITSELF a correction run. Read STRUCTURALLY from
 * skill_runs.is_correction (set at run creation by startCorrectionRun), NOT from
 * the audit trail: the correction-start audit is written only AFTER the run has
 * executed — and thus after that run's own end-of-run criteria evaluation has
 * already fired — so it would be too late to stop a synchronously-completing
 * correction run from re-triggering. The column is set atomically at creation,
 * so the run is recognisable as a correction the instant it self-evaluates.
 * RLS scopes the read to the tenant; a foreign runId is simply "not found".
 */
async function sourceRunIsCorrection(tx: Tx, sourceRunId: string): Promise<boolean> {
  const run = await tx.skillRun.findUnique({
    where: { id: sourceRunId },
    select: { isCorrection: true },
  });
  return run?.isCorrection === true;
}

/** Count auto-correction starts for this org within the rolling window. */
async function autoCorrectionsInWindow(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n
    FROM "audit_log"
    WHERE "action" = ${AUTO_CORRECTION_ACTION}
      AND "created_at" > now() - (${AUTO_CORRECTION_WINDOW_HOURS} * interval '1 hour')
  `;
  return Number(rows[0]?.n ?? 0n);
}

/**
 * Auto-start a correction for a freshly-raised criteria flag, if and only if all
 * four brakes allow it. Call AFTER the flag tx commits; best-effort (never
 * throws). `correction` is the flag's re-run pointer (present only for criteria
 * flags under suggest/autonomous). Self-contained: it re-reads the tenant's
 * autonomy (brake 1) and checks the anti-loop + limit brakes itself, so any
 * caller that has a `correction` may call it unconditionally — a non-autonomous
 * tenant simply gets a no-op skip.
 */
export async function maybeAutoCorrect(
  orgId: string,
  correction: CorrectionRef,
): Promise<AutoCorrectOutcome> {
  try {
    // Brakes 1 + 3 + 4 in ONE short read tx (all fast reads): autonomy level,
    // anti-loop (is the source itself a correction?), and the daily count.
    // Deciding here — before any run start — keeps the guard cheap and
    // race-tolerant enough (a rare double-count at the limit boundary only ever
    // UNDER-starts, never over-starts).
    const decision = await withTenant(orgId, async (tx) => {
      if (!(await resolveAutonomyContext(tx, orgId)).autoStart) {
        return { block: 'not_autonomous' as const };
      }
      if (await sourceRunIsCorrection(tx, correction.sourceRunId)) {
        return { block: 'source_is_correction' as const };
      }
      const used = await autoCorrectionsInWindow(tx);
      if (used >= MAX_AUTO_CORRECTIONS_PER_DAY) {
        return { block: 'limit_reached' as const, used };
      }
      return { block: null };
    });

    if (decision.block === 'not_autonomous') {
      // Not autonomous (report/suggest) → never auto-start. Silent no-op.
      return { kind: 'skipped', reason: 'not_autonomous' };
    }

    if (decision.block === 'source_is_correction') {
      // Anti-loop: report only. No audit noise here — the flag itself already
      // records the deviation; we simply do not escalate it to a run.
      return { kind: 'skipped', reason: 'source_is_correction' };
    }

    if (decision.block === 'limit_reached') {
      // Limit reached: write a clear audit so a human sees a correction is
      // pending but was NOT auto-started. Best-effort, its own short tx.
      await withTenant(orgId, (tx) =>
        logAudit(tx, {
          orgId,
          actorId: CORRECTION_ACTOR,
          actorType: 'agent',
          action: AUTO_CORRECTION_LIMIT_ACTION,
          target: `${correction.skillKey}:${correction.sourceRunId}`,
          detail: {
            reason: 'daily auto-correction limit reached',
            limit: MAX_AUTO_CORRECTIONS_PER_DAY,
            windowHours: AUTO_CORRECTION_WINDOW_HOURS,
            used: decision.used,
            sourceRunId: correction.sourceRunId,
            skillKey: correction.skillKey,
          },
        }),
      );
      return { kind: 'skipped', reason: 'limit_reached' };
    }

    // All brakes clear → start the correction via the SAME Schritt-D path, marked
    // as a loop trigger (audits loop.auto_correction_started, actorType 'agent').
    // startCorrectionRun re-checks autonomy and routes the run through the normal
    // approval gate — it can pause at awaiting_approval; we never approve it.
    const result = await startCorrectionRun({
      orgId,
      actorUserId: CORRECTION_ACTOR,
      skillKey: correction.skillKey,
      sourceRunId: correction.sourceRunId,
      trigger: 'loop',
    });
    return { kind: 'started', runId: result.runId };
  } catch (err) {
    // Best-effort: a failed auto-start never breaks the run that raised the flag.
    logError('auto-correction failed (best-effort, flag unaffected)', err, {
      orgId,
      sourceRunId: correction.sourceRunId,
    });
    return { kind: 'skipped', reason: 'error' };
  }
}
