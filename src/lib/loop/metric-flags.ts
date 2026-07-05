// Turn a failed process metric (src/lib/loop/metrics.ts) into the audit-flag
// shape the UI already understands.
//
// CRITICAL CONTRACT — this MUST match what toFlagView (src/lib/loop/flags-view.ts)
// reads for a metric flag, or the flag will render blank in the cockpit and on
// /flags. toFlagView's flat metric path reads exactly:
//   detail.category === 'metric'
//   detail.metric    → the deviation key
//   detail.expected  → Soll (the threshold)
//   detail.actual    → Ist (the observed value)
//   detail.severity  → 'warning' | 'critical'
//   detail.message   → optional human line
// and the audit row's `target` is the metric key. tests/loop-flags-view.test.ts
// pins that path; tests/loop-metrics.test.ts pins that this builder produces it.

import type { AuditEntry } from '../audit';
import type { LoopMetric } from './metrics';

export const LOOP_ACTOR = 'loop-engine';
export const METRIC_FLAG_ACTION = 'flag.metric_deviation';

export type FlagSeverity = 'warning' | 'critical';

/**
 * Severity by how far the value overshoots the threshold in the bad direction.
 * Warning by default; critical once the miss exceeds half the threshold — a
 * deliberately conservative, deterministic rule (no config, no LLM). For a
 * value of null the metric would have passed, so this is only called on a real
 * miss; we still guard and return 'warning' if value is somehow null.
 */
export function metricSeverity(metric: LoopMetric): FlagSeverity {
  if (metric.value == null) return 'warning';
  const gap =
    metric.direction === 'atLeast'
      ? metric.threshold - metric.value // healthy is ≥ threshold; positive gap = miss
      : metric.value - metric.threshold; // healthy is ≤ threshold; positive gap = miss
  if (gap <= 0) return 'warning'; // not actually a miss (defensive)
  // Critical when the miss is more than half of the threshold magnitude.
  const scale = Math.abs(metric.threshold) || 1;
  return gap >= 0.5 * scale ? 'critical' : 'warning';
}

/**
 * Build the logAudit() entry for a metric deviation. The `detail` is the flat
 * shape toFlagView reads; `target` is the metric key so the flag points at the
 * metric. `orgId` is passed through for the audit row's tenant column.
 */
export function buildMetricFlag(orgId: string, metric: LoopMetric): AuditEntry {
  return {
    orgId,
    actorId: LOOP_ACTOR,
    actorType: 'agent',
    action: METRIC_FLAG_ACTION,
    target: metric.key,
    detail: {
      category: 'metric',
      metric: metric.key,
      // Soll / Ist — the exact fields toFlagView projects into a FlagDeviation.
      expected: metric.threshold,
      actual: metric.value,
      direction: metric.direction,
      severity: metricSeverity(metric),
      message: metric.detail.message,
      // Extra transparency (ignored by toFlagView, visible in the raw expand).
      ...(metric.detail.numerator != null ? { numerator: metric.detail.numerator } : {}),
      ...(metric.detail.denominator != null ? { denominator: metric.detail.denominator } : {}),
      ...(metric.detail.worst ? { worst: metric.detail.worst } : {}),
    },
  };
}
