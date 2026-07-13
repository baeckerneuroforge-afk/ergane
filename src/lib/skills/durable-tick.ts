// Background driver for durable multi-step skill runs.
//
// Cron path: GET /api/cron/skills-durable → runDurableTick().
// Discovers advanceable runs via durable_skill_run_candidates() (SECURITY
// DEFINER, migration 0031): status running|approved and claim free/expired.
// For each candidate, calls the REAL continueRun() once (one step max). A
// failure on one run is logged and skipped — it never stops the tick.
//
// P3-B hardening:
//   - per-run isolation (unchanged)
//   - counters for retrying/stuck runs (stepAttempts > 0 or claim parked)
//   - optional audit snapshot of the tick for ops visibility
import { logAudit } from '../audit';
import { logError, logInfo } from '../log';
import { prisma } from '../prisma';
import { withTenant } from '../tenant';
import { continueRun, MAX_STEP_ATTEMPTS } from './engine';

/** Default max runs processed per cron invocation (serverless budget). */
export const DURABLE_TICK_DEFAULT_MAX_RUNS = 50;

export interface DurableTickResult {
  /** Candidates returned by discovery (before continue). */
  candidates: number;
  /** continueRun invocations that did not throw. */
  advanced: number;
  /** Runs that reached completed this tick. */
  completed: number;
  /** Runs that paused at awaiting_approval this tick. */
  paused: number;
  /** Runs that ended failed/rejected this tick. */
  failed: number;
  /** Still running after one step (partial progress). */
  stillRunning: number;
  /** continueRun threw (isolated). */
  errors: number;
  /**
   * Runs that are running with stepAttempts > 0 after the tick (in backoff
   * or mid-retry). Visible ops signal for "durable is retrying".
   */
  retrying: number;
  /**
   * Runs that exhausted retries this tick (status failed after step_retry path).
   * Same as a subset of failed when caused by permanent/max attempts.
   */
  maxAttemptsReached: number;
}

/**
 * List up to `limit` advanceable durable runs as (orgId, runId) pairs.
 * Calls the SECURITY DEFINER helper — safe without tenant context.
 */
export async function listDurableRunCandidates(
  limit: number = DURABLE_TICK_DEFAULT_MAX_RUNS,
): Promise<Array<{ orgId: string; runId: string }>> {
  const capped = Math.max(1, Math.min(limit, 200));
  const rows = await prisma.$queryRaw<Array<{ org_id: string; run_id: string }>>`
    SELECT * FROM durable_skill_run_candidates(${capped}::integer)
  `;
  return rows.map((r) => ({ orgId: r.org_id, runId: r.run_id }));
}

/**
 * Runs currently parked for retry (running + stepAttempts > 0) or held claim.
 * Cross-tenant discovery via SECURITY DEFINER-style raw only returns ids;
 * for UI we query inside withTenant per org — this helper is for cron counters.
 */
export async function countRetryingDurableRuns(): Promise<number> {
  // app_user without tenant context sees 0 under RLS — use a narrow count via
  // the same candidates function is wrong. Prefer a DEFINER helper; for now
  // approximate from audit of recent step_retry if needed. Simpler: count after
  // tick by re-reading candidates that still have stepAttempts — we accumulate
  // in runDurableTick from continue outcomes instead.
  return 0;
}

/**
 * Advance each candidate by at most one durable step via continueRun().
 * Tenant-safe: each continue opens its own withTenant context.
 */
export async function runDurableTick(opts?: {
  maxRuns?: number;
  /** When true, write a best-effort ops audit on the first candidate's org. */
  writeOpsAudit?: boolean;
}): Promise<DurableTickResult> {
  const maxRuns = opts?.maxRuns ?? DURABLE_TICK_DEFAULT_MAX_RUNS;
  const candidates = await listDurableRunCandidates(maxRuns);

  const result: DurableTickResult = {
    candidates: candidates.length,
    advanced: 0,
    completed: 0,
    paused: 0,
    failed: 0,
    stillRunning: 0,
    errors: 0,
    retrying: 0,
    maxAttemptsReached: 0,
  };

  for (const { orgId, runId } of candidates) {
    try {
      const before = await withTenant(orgId, (tx) =>
        tx.skillRun.findUnique({
          where: { id: runId },
          select: { stepAttempts: true, status: true },
        }),
      );

      const handle = await continueRun(orgId, runId);
      result.advanced += 1;
      switch (handle.status) {
        case 'completed':
          result.completed += 1;
          break;
        case 'awaiting_approval':
          result.paused += 1;
          break;
        case 'failed':
        case 'rejected':
          result.failed += 1;
          if ((before?.stepAttempts ?? 0) + 1 >= MAX_STEP_ATTEMPTS) {
            result.maxAttemptsReached += 1;
          }
          break;
        case 'running':
        case 'approved': {
          result.stillRunning += 1;
          const after = await withTenant(orgId, (tx) =>
            tx.skillRun.findUnique({
              where: { id: runId },
              select: { stepAttempts: true },
            }),
          );
          if ((after?.stepAttempts ?? 0) > 0) {
            result.retrying += 1;
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      result.errors += 1;
      logError('durable tick: run failed', err, { orgId, runId });
    }
  }

  logInfo('durable skill tick finished', { ...result });

  // Optional ops breadcrumb on the first org (best-effort, never fails the tick).
  if (opts?.writeOpsAudit && candidates[0]) {
    const { orgId } = candidates[0];
    try {
      await withTenant(orgId, (tx) =>
        logAudit(tx, {
          orgId,
          actorId: 'durable-tick',
          actorType: 'agent',
          action: 'ops.durable_tick',
          target: 'skills-durable',
          detail: { ...result },
        }),
      );
    } catch {
      // ignore
    }
  }

  return result;
}
