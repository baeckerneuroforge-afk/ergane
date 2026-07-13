// Pure merge of loop metric / criteria overrides with code defaults.
// No DB access — unit-testable without a transaction.
// Does NOT import metrics.ts (avoids circular deps with computeLoopMetrics).

import { MIN_LENGTH_CHARS, MIN_USE_CASES } from './criteria/framework';
import {
  USE_CASES_MIN_ITEMS,
  USE_CASES_MIN_LENGTH,
  type UseCasesCriteriaThresholds,
} from './criteria/use_cases';

/** Keep in sync with LoopMetricKey in metrics.ts. */
export const LOOP_METRIC_KEYS = [
  'success_rate',
  'approval_rate',
  'iteration_rate',
  'feedback_negative_rate',
  'open_tickets_without_acceptance',
  'stale_open_tickets',
  'commits_without_ticket',
  'tickets_done_without_commit',
] as const;

export type ThresholdMetricKey = (typeof LOOP_METRIC_KEYS)[number];

export type MetricDirection = 'atLeast' | 'atMost';

export type MetricThresholdMap = Partial<
  Record<ThresholdMetricKey, { threshold: number; direction?: MetricDirection }>
>;

export interface CriteriaTypeOverrides {
  min_use_cases?: number;
  min_length?: number;
}

export type CriteriaOverridesMap = Partial<
  Record<'framework' | 'use_cases' | 'briefing', CriteriaTypeOverrides>
>;

/**
 * Merge stored JSON (unknown) into a clean MetricThresholdMap.
 * Invalid keys/values are dropped (fail-closed to defaults).
 */
export function parseMetricThresholdOverrides(raw: unknown): MetricThresholdMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MetricThresholdMap = {};
  for (const key of LOOP_METRIC_KEYS) {
    const entry = (raw as Record<string, unknown>)[key];
    if (entry == null) continue;
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      out[key] = { threshold: entry };
      continue;
    }
    if (typeof entry === 'object' && !Array.isArray(entry)) {
      const thr = (entry as { threshold?: unknown }).threshold;
      const dir = (entry as { direction?: unknown }).direction;
      if (typeof thr === 'number' && Number.isFinite(thr)) {
        out[key] = {
          threshold: thr,
          ...(dir === 'atLeast' || dir === 'atMost' ? { direction: dir } : {}),
        };
      }
    }
  }
  return out;
}

export function parseCriteriaOverrides(raw: unknown): CriteriaOverridesMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: CriteriaOverridesMap = {};
  for (const type of ['framework', 'use_cases', 'briefing'] as const) {
    const entry = (raw as Record<string, unknown>)[type];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const o: CriteriaTypeOverrides = {};
    if (
      typeof e.min_use_cases === 'number' &&
      Number.isFinite(e.min_use_cases) &&
      e.min_use_cases >= 0
    ) {
      o.min_use_cases = e.min_use_cases;
    }
    if (typeof e.min_length === 'number' && Number.isFinite(e.min_length) && e.min_length >= 0) {
      o.min_length = e.min_length;
    }
    if (Object.keys(o).length > 0) out[type] = o;
  }
  return out;
}

export function resolveFrameworkCriteriaThresholds(
  overrides: CriteriaOverridesMap = {},
): { min_use_cases: number; min_length: number } {
  const o = overrides.framework ?? {};
  return {
    min_use_cases: o.min_use_cases ?? MIN_USE_CASES,
    min_length: o.min_length ?? MIN_LENGTH_CHARS,
  };
}

export function resolveUseCasesCriteriaThresholds(
  overrides: CriteriaOverridesMap = {},
): UseCasesCriteriaThresholds {
  const o = overrides.use_cases ?? {};
  return {
    min_use_cases: o.min_use_cases ?? USE_CASES_MIN_ITEMS,
    min_length: o.min_length ?? USE_CASES_MIN_LENGTH,
  };
}

/**
 * Resolve one metric against defaults + optional override map.
 * `defaults` is METRIC_THRESHOLDS from metrics.ts (passed in to avoid cycles).
 */
export function resolveMetricThreshold(
  key: ThresholdMetricKey,
  defaults: Record<ThresholdMetricKey, { threshold: number; direction: MetricDirection }>,
  overrides: MetricThresholdMap = {},
): { threshold: number; direction: MetricDirection } {
  const base = defaults[key];
  const o = overrides[key];
  return {
    threshold: o?.threshold ?? base.threshold,
    direction: o?.direction ?? base.direction,
  };
}
