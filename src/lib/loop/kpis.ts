// Loop KPI snapshot for cockpit + flags page (no LLM, no network).
//
// Aggregates what the closed loop already writes into the audit trail and
// approvals table: flag volume, correction activity, and human approval latency.
// Always call inside withTenant() so RLS scopes every read.
import type { Tx } from '../tenant';
import { computeLoopMetrics, type LoopMetric } from './metrics';

export const LOOP_KPI_WINDOW_DAYS = 7;

export interface LoopKpiSnapshot {
  since: Date;
  /** audit rows with action starting with 'flag.' in the window */
  flags: number;
  /** human-requested corrections (flag.correction_requested) */
  humanCorrections: number;
  /** loop auto-starts (loop.auto_correction_started) */
  autoCorrections: number;
  /** human + auto */
  corrections: number;
  pendingApprovals: number;
  /**
   * Median time from approval created → decided (ms) for approvals decided
   * in the window. null when none decided yet (no false alarm).
   */
  approvalLatencyMedianMs: number | null;
  /** Process metrics currently within target (or unmeasurable). */
  processMetricsHealthy: number;
  processMetricsTotal: number;
  processMetrics: LoopMetric[];
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Compute loop KPIs for one tenant. Sequential reads on the caller's pinned tx.
 */
export async function computeLoopKpis(
  tx: Tx,
  orgId: string,
  opts: { since?: Date } = {},
): Promise<LoopKpiSnapshot> {
  const since =
    opts.since ??
    new Date(Date.now() - LOOP_KPI_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Deviation raises only — exclude status transitions and correction requests
  // so acking a flag does not inflate the deviation count (P2 review).
  const flags = await tx.auditLog.count({
    where: {
      action: { in: ['flag.criteria_violated', 'flag.metric_deviation'] },
      createdAt: { gte: since },
    },
  });
  const humanCorrections = await tx.auditLog.count({
    where: { action: 'flag.correction_requested', createdAt: { gte: since } },
  });
  const autoCorrections = await tx.auditLog.count({
    where: { action: 'loop.auto_correction_started', createdAt: { gte: since } },
  });
  const pendingApprovals = await tx.approval.count({
    where: { status: 'pending' },
  });

  const decided = await tx.approval.findMany({
    where: {
      status: { in: ['approved', 'rejected'] },
      decidedAt: { gte: since },
    },
    select: { createdAt: true, decidedAt: true },
    take: 500,
    orderBy: { decidedAt: 'desc' },
  });
  const latencies: number[] = [];
  for (const row of decided) {
    if (!row.decidedAt) continue;
    const ms = row.decidedAt.getTime() - row.createdAt.getTime();
    if (ms >= 0) latencies.push(ms);
  }

  const { metrics } = await computeLoopMetrics(tx, orgId, { since });
  const processMetricsHealthy = metrics.filter((m) => m.passed).length;

  return {
    since,
    flags,
    humanCorrections,
    autoCorrections,
    corrections: humanCorrections + autoCorrections,
    pendingApprovals,
    approvalLatencyMedianMs: median(latencies),
    processMetricsHealthy,
    processMetricsTotal: metrics.length,
    processMetrics: metrics,
  };
}

/** Format median latency for UI (e.g. "12 min", "2.5 h", "—"). */
export function formatApprovalLatencyMs(
  ms: number | null,
  locale: 'en' | 'de' = 'en',
): string {
  if (ms == null) return locale === 'de' ? '—' : '—';
  const min = ms / 60_000;
  if (min < 1) {
    return locale === 'de' ? '< 1 Min.' : '< 1 min';
  }
  if (min < 60) {
    const n = Math.round(min);
    return locale === 'de' ? `${n} Min.` : `${n} min`;
  }
  const h = min / 60;
  const rounded = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  return locale === 'de' ? `${rounded} Std.` : `${rounded} h`;
}
