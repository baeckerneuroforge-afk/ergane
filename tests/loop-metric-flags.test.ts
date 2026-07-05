import { describe, expect, it } from 'vitest';
import { buildMetricFlag, metricSeverity } from '../src/lib/loop/metric-flags';
import { toFlagView } from '../src/lib/loop/flags-view';
import type { AuditLog } from '@prisma/client';
import type { LoopMetric } from '../src/lib/loop/metrics';

function metric(over: Partial<LoopMetric> = {}): LoopMetric {
  return {
    key: 'success_rate',
    value: 0.5,
    threshold: 0.7,
    direction: 'atLeast',
    passed: false,
    detail: { message: 'Success rate 50% (target ≥ 70%).' },
    ...over,
  };
}

// Make buildMetricFlag's AuditEntry look like a stored AuditLog row so we can
// run it back through the real Schritt-B projection without a database.
function asRow(orgId: string, m: LoopMetric): AuditLog {
  const entry = buildMetricFlag(orgId, m);
  return {
    id: 'flag-1',
    orgId,
    actorId: entry.actorId,
    actorType: 'agent',
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail as AuditLog['detail'],
    createdAt: new Date('2026-07-05T00:00:00Z'),
  };
}

describe('metricSeverity', () => {
  it('atLeast: large miss (> half threshold) → critical', () => {
    // threshold 0.7, value 0.25 → gap 0.45 ≥ 0.35 → critical
    expect(metricSeverity(metric({ value: 0.25 }))).toBe('critical');
  });

  it('atLeast: small miss → warning', () => {
    // threshold 0.7, value 0.5 → gap 0.2 < 0.35 → warning
    expect(metricSeverity(metric({ value: 0.5 }))).toBe('warning');
  });

  it('atMost: large overshoot → critical', () => {
    // feedback rate: threshold 0.15, value 0.5 → gap 0.35 ≥ 0.075 → critical
    expect(
      metricSeverity(
        metric({ key: 'feedback_negative_rate', threshold: 0.15, direction: 'atMost', value: 0.5 }),
      ),
    ).toBe('critical');
  });

  it('atMost: small overshoot → warning', () => {
    // iteration_rate: threshold 3, value 4 → gap 1 < 1.5 → warning
    expect(
      metricSeverity(
        metric({ key: 'iteration_rate', threshold: 3, direction: 'atMost', value: 4 }),
      ),
    ).toBe('warning');
  });

  it('null value → warning (defensive; a null value would not fail anyway)', () => {
    expect(metricSeverity(metric({ value: null }))).toBe('warning');
  });
});

describe('buildMetricFlag shape matches toFlagView', () => {
  it('produces category/metric/expected/actual/severity that project cleanly', () => {
    const m = metric({ value: 0.25 });
    const entry = buildMetricFlag('org-1', m);

    // The exact fields toFlagView reads for a metric flag.
    expect(entry.action).toBe('flag.metric_deviation');
    expect(entry.target).toBe('success_rate');
    expect(entry.actorId).toBe('loop-engine');
    expect(entry.actorType).toBe('agent');
    expect(entry.detail).toMatchObject({
      category: 'metric',
      metric: 'success_rate',
      expected: 0.7,
      actual: 0.25,
      severity: 'critical',
    });

    const view = toFlagView(asRow('org-1', m));
    expect(view.category).toBe('metric');
    expect(view.deviations).toEqual([
      { key: 'success_rate', expected: '0.7', actual: '0.25', message: m.detail.message },
    ]);
  });

  it('carries iteration_rate worst-group context in the raw detail', () => {
    const m = metric({
      key: 'iteration_rate',
      value: 5,
      threshold: 3,
      direction: 'atMost',
      detail: {
        message: 'Up to 5 runs for the same client+skill (target ≤ 3).',
        worst: { skillKey: 'transkript_zu_framework', clientId: 'client-x', runs: 5 },
      },
    });
    const entry = buildMetricFlag('org-1', m);
    expect(entry.detail).toMatchObject({
      metric: 'iteration_rate',
      worst: { skillKey: 'transkript_zu_framework', clientId: 'client-x', runs: 5 },
    });
    // toFlagView still yields a single clean deviation for the row.
    const view = toFlagView(asRow('org-1', m));
    expect(view.deviations[0]!.key).toBe('iteration_rate');
    expect(view.deviations[0]!.actual).toBe('5');
  });
});
