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
import { CORRECTION_ACTOR, startCorrectionRun } from './correct';
import { resolveAutonomyContext } from './settings';
import type { CorrectionRef } from './suggest';

/** Max automatic correction runs per org per rolling 24h (code constant, plan §11). */
export const MAX_AUTO_CORRECTIONS_PER_DAY = 3;

/** Rolling window the daily limit is counted over. */
export const AUTO_CORRECTION_WINDOW_HOURS = 24;

/** Audit written when the daily limit blocks an auto-start (a human should look). */
export const AUTO_CORRECTION_LIMIT_ACTION = 'loop.auto_correction_limit_reached';

/**
 * Audit written as the rate-limit RESERVATION inside the locked decision tx —
 * the row the daily-cap count is taken over. Deliberately SEPARATE from the
 * loop.auto_correction_started row (which stays the UI marker, targeting the
 * started run's id): the reservation is written before the run exists, so it
 * cannot carry the runId, and keeping the two rows distinct means the existing
 * consumers of loop.auto_correction_started (flags + run pages) are unchanged.
 */
export const AUTO_CORRECTION_RESERVED_ACTION = 'loop.auto_correction_reserved';

/**
 * Namespace (first key of pg_advisory_xact_lock's two-int form) for the per-org
 * auto-correction decision lock. An arbitrary fixed constant that identifies
 * THIS lock class so its per-org keys never collide with another advisory-lock
 * user. Not security-sensitive; just needs to be stable and unique in the app.
 */
export const AUTO_CORRECTION_LOCK_NAMESPACE = 0x10_0b; // "loop" auto-correct

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

/**
 * Serialize auto-correction decisions for ONE org via a transaction-scoped
 * advisory lock. Two criteria flags raised concurrently would otherwise both
 * pass the count-then-start check and OVER-start beyond the daily cap (the
 * limit-defeating race the fix-plan calls out). The lock is transaction-scoped
 * (`pg_advisory_xact_lock`) so it is released automatically at COMMIT/ROLLBACK,
 * even on error; withTenant pins one backend for the whole tx, so it holds
 * correctly. The key is derived from the orgId (hashtext → int8) under a fixed
 * namespace so it cannot collide with any other advisory-lock user.
 */
async function lockAutoCorrectForOrg(tx: Tx, orgId: string): Promise<void> {
  // pg_advisory_xact_lock(key1 int4, key2 int4): key1 namespaces this lock class,
  // key2 is the per-org key (hashtext returns int4). Two things matter here:
  //   - the ::int4 cast on the namespace is REQUIRED: Prisma binds a JS number as
  //     numeric, and pg_advisory_xact_lock(numeric, integer) does not exist;
  //   - use $executeRaw, NOT $queryRaw: the function returns void, which $queryRaw
  //     cannot deserialize ("Failed to deserialize column of type 'void'"). Since
  //     maybeAutoCorrect swallows errors, either mistake would silently leave the
  //     lock un-taken. $executeRaw runs the statement without deserializing rows.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUTO_CORRECTION_LOCK_NAMESPACE}::int4, hashtext(${orgId}))`;
}

/**
 * Count auto-correction RESERVATIONS for this org within the rolling window.
 * Correctness under concurrency does NOT rely on when a run row commits: the
 * decision below both COUNTS these rows and WRITES the next reservation inside
 * the SAME advisory-locked transaction, so count-then-reserve is atomic per org.
 * Two concurrent flags serialize on the lock; exactly MAX_AUTO_CORRECTIONS_PER_DAY
 * reservations can ever be written in the window — no over-start.
 */
async function autoCorrectionsInWindow(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n
    FROM "audit_log"
    WHERE "action" = ${AUTO_CORRECTION_RESERVED_ACTION}
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
    // Brakes 1 + 3 + 4 in ONE short tx, SERIALIZED PER ORG by an advisory lock:
    // autonomy level, anti-loop (is the source itself a correction?), and the
    // daily count. Crucially the count AND the slot reservation happen inside the
    // same locked tx — so two criteria flags raised concurrently can no longer
    // both pass `used < limit` and over-start (the limit-defeating race the fix
    // plan calls out). The lock is transaction-scoped and released at COMMIT.
    const decision = await withTenant(orgId, async (tx) => {
      await lockAutoCorrectForOrg(tx, orgId);
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
      // RESERVE the slot NOW, inside the locked tx: a dedicated reservation audit
      // row (distinct from the UI's loop.auto_correction_started, which the start
      // still writes with the real runId). This reservation is what a concurrent
      // decision counts, so it can never reuse this slot.
      //
      // TRADE-OFF (deliberate, fail-safe): audit_log is append-only, so this
      // reservation cannot be rolled back if startCorrectionRun() below then
      // throws (it runs in its OWN tx, after this one commits). Such a slot is
      // consumed for the 24h window with no run started. This can only UNDER-start
      // (the safe direction — never over-start, which was the bug we are fixing),
      // and the throw window is tiny: autonomy + anti-loop were just checked, and
      // startCorrectionRun re-validates the same source run under RLS. We accept
      // the rare wasted slot rather than add a compensating path that append-only
      // forbids anyway.
      await logAudit(tx, {
        orgId,
        actorId: CORRECTION_ACTOR,
        actorType: 'agent',
        action: AUTO_CORRECTION_RESERVED_ACTION,
        target: `${correction.skillKey}:${correction.sourceRunId}`,
        detail: { sourceRunId: correction.sourceRunId, clientId: correction.clientId ?? null },
      });
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
    // as a loop trigger (writes loop.auto_correction_started with the started
    // run's id — the UI marker). startCorrectionRun re-checks autonomy and routes
    // the run through the normal approval gate — it can pause at awaiting_approval;
    // we never approve it. The rate-limit reservation above is a separate row.
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
