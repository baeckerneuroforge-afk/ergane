// Background driver for durable multi-step skill runs.
//
// Cron path: GET /api/cron/skills-durable → runDurableTick().
// Discovers advanceable runs via durable_skill_run_candidates() (SECURITY
// DEFINER, migration 0031): status running|approved and claim free/expired.
// For each candidate, calls the REAL continueRun() once (one step max). A
// failure on one run is logged and skipped — it never stops the tick.
//
// Does NOT reimplement step execution. Does NOT bypass claims: continueRun
// itself refuses a held lease (busy no-op).
import { logError } from '../log';
import { prisma } from '../prisma';
import { continueRun } from './engine';

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
}

/**
 * List up to `limit` advanceable durable runs as (orgId, runId) pairs.
 * Calls the SECURITY DEFINER helper — safe without tenant context.
 */
export async function listDurableRunCandidates(
  limit: number = DURABLE_TICK_DEFAULT_MAX_RUNS,
): Promise<Array<{ orgId: string; runId: string }>> {
  const capped = Math.max(1, Math.min(limit, 200));
  // Prisma binds JS numbers as bigint; the SQL function takes integer — cast.
  const rows = await prisma.$queryRaw<Array<{ org_id: string; run_id: string }>>`
    SELECT * FROM durable_skill_run_candidates(${capped}::integer)
  `;
  return rows.map((r) => ({ orgId: r.org_id, runId: r.run_id }));
}

/**
 * Advance each candidate by at most one durable step via continueRun().
 * Tenant-safe: each continue opens its own withTenant context.
 */
export async function runDurableTick(opts?: {
  maxRuns?: number;
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
  };

  for (const { orgId, runId } of candidates) {
    try {
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
          break;
        case 'running':
        case 'approved':
          result.stillRunning += 1;
          break;
        default:
          break;
      }
    } catch (err) {
      result.errors += 1;
      logError('durable tick: run failed', err, { orgId, runId });
    }
  }

  return result;
}
