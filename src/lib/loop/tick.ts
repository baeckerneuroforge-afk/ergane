// The periodic loop tick — the trend-driven flag trigger (Schritt C + F).
//
// runLoopTick() is the cron path (route /api/cron/loop). The tenant list comes
// from loop_org_ids() (SECURITY DEFINER, migration 0025): every org, no context
// needed, ids only. For each org:
//   A) short withTenant tx: computeLoopMetrics → metric flags (dedup)
//   B) OUTSIDE tx: tool observation sources + pure criteria checks
//   C) short withTenant tx: criteria flags for tool artifacts (dedup)
//   D) after commit: notifyFlag best-effort
//
// Deliverable criteria stay event-driven in evaluate.ts (not re-checked here).
// Tool flags never carry a correction pointer (nothing to re-run).

import type { AuditLog } from '@prisma/client';
import { logAudit } from '../audit';
import { logError } from '../log';
import { prisma } from '../prisma';
import { withTenant, type Tx } from '../tenant';
import { getCriteriaForObservationType } from './criteria/registry';
import type { CriterionResult } from './criteria/types';
import { createLoopFlagInTx } from './flags';
import { toFlagView } from './flags-view';
import { buildMetricFlag, METRIC_FLAG_ACTION } from './metric-flags';
import { computeLoopMetrics } from './metrics';
import { notifyFlag } from './notify';
import { resolveAutonomyContext } from './settings';
import { getPeriodicObservationSources } from './sources';
import type { Observation } from './sources/types';
import {
  buildMetricSuggestedActionText,
  buildToolSuggestedActionText,
} from './suggest';

/** How far back the metric window reaches (plan §8: last 7 days). */
export const LOOP_WINDOW_DAYS = 7;

/**
 * Dedup horizon: a metric flag is not repeated within this window. Matched to
 * the cron cadence (once per day, vercel.json) so a daily tick never re-raises
 * the same metric flag it already raised on the previous run.
 */
export const DEDUP_HOURS = 24;

const CRITERIA_FLAG_ACTION = 'flag.criteria_violated';
const LOOP_ACTOR = 'loop-engine';

export interface LoopTickResult {
  orgs: number;
  flagsRaised: number;
  failed: number;
}

/**
 * True when an identical metric flag (same metric key) already exists for THIS
 * tenant within the dedup window. Runs on the caller's tx — RLS scopes it to the
 * org, so this can only ever see the tenant's own audit rows. The `detail->>'metric'`
 * filter matches the flat metric-flag shape written by buildMetricFlag().
 */
async function hasRecentMetricFlag(tx: Tx, metricKey: string): Promise<boolean> {
  // Multiply a 1-hour interval by the (numeric) horizon — avoids make_interval's
  // strict int typing, which rejects Prisma's bigint-bound parameters.
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n
    FROM "audit_log"
    WHERE "action" = ${METRIC_FLAG_ACTION}
      AND "detail" ->> 'metric' = ${metricKey}
      AND "created_at" > now() - (${DEDUP_HOURS} * interval '1 hour')
  `;
  return (rows[0]?.n ?? 0n) > 0n;
}

/**
 * Dedup tool criteria flags: same externalRef + same failed criterion key
 * within DEDUP_HOURS ⇒ skip (alarm fatigue).
 */
async function hasRecentToolCriteriaFlag(
  tx: Tx,
  externalRef: string,
  criterionKey: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n
    FROM "audit_log"
    WHERE "action" = ${CRITERIA_FLAG_ACTION}
      AND "target" = ${externalRef}
      AND "created_at" > now() - (${DEDUP_HOURS} * interval '1 hour')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE("detail"->'failedCriteria', '[]'::jsonb)) AS elem
        WHERE elem->>'criterion' = ${criterionKey}
      )
  `;
  return (rows[0]?.n ?? 0n) > 0n;
}

interface PendingToolFlag {
  observation: Observation;
  failed: CriterionResult[];
  suggestedAction?: string;
}

/**
 * Evaluate periodic tool sources OUTSIDE any transaction (DB reads for fetch
 * only; pure criteria after). Returns pending flags to write in a short tx.
 */
export async function evaluateToolObservations(
  orgId: string,
  since: Date,
  opts: { suggest: boolean; locale: 'en' | 'de' },
): Promise<PendingToolFlag[]> {
  const pending: PendingToolFlag[] = [];
  for (const source of getPeriodicObservationSources()) {
    const observations = await source.fetchObservations(orgId, since);
    for (const obs of observations) {
      const set = getCriteriaForObservationType(obs.type);
      if (!set) continue;
      const results = set.criteria.map((c) => c.check(obs));
      const failed = results.filter((r) => !r.passed);
      if (failed.length === 0) continue;
      pending.push({
        observation: obs,
        failed,
        suggestedAction: opts.suggest
          ? buildToolSuggestedActionText(opts.locale, obs.externalRef)
          : undefined,
      });
    }
  }
  return pending;
}

/**
 * Run the metric check for one tenant and raise flags for deviations, with
 * dedup — all inside one short transaction. Returns how many NEW flags were
 * written. Throws only on an actual DB error (the caller isolates it).
 */
export async function runLoopTickForOrg(orgId: string, since: Date): Promise<number> {
  // A) Metric flags in one short tx.
  const metricFlagRows = await withTenant(orgId, async (tx) => {
    const { metrics } = await computeLoopMetrics(tx, orgId, { since });
    const { locale, suggest } = await resolveAutonomyContext(tx, orgId);
    const suggestion = suggest ? buildMetricSuggestedActionText(locale) : undefined;

    const rows: AuditLog[] = [];
    for (const metric of metrics) {
      if (metric.passed) continue;
      if (await hasRecentMetricFlag(tx, metric.key)) continue;
      const entry = buildMetricFlag(orgId, metric, suggestion);
      const audit = await logAudit(tx, entry);
      await createLoopFlagInTx(tx, {
        orgId,
        action: entry.action,
        target: entry.target ?? metric.key,
        category: 'metric',
        severity: String((entry.detail as { severity?: string })?.severity ?? 'warning'),
        detail: (entry.detail ?? {}) as Record<string, unknown>,
        auditId: audit.id,
      });
      rows.push(audit);
    }
    // Stash autonomy for tool path (same short read already done).
    return { rows, locale, suggest };
  });

  // B+C) Tool observations: fetch+check outside long work; write in short tx.
  const toolPending = await evaluateToolObservations(orgId, since, {
    suggest: metricFlagRows.suggest,
    locale: metricFlagRows.locale,
  });

  const toolFlagRows =
    toolPending.length === 0
      ? ([] as AuditLog[])
      : await withTenant(orgId, async (tx) => {
          const rows: AuditLog[] = [];
          for (const item of toolPending) {
            // Dedup per failed criterion (same ticket + criterion within window).
            const stillFailed: CriterionResult[] = [];
            for (const f of item.failed) {
              if (await hasRecentToolCriteriaFlag(tx, item.observation.externalRef, f.key)) {
                continue;
              }
              stillFailed.push(f);
            }
            if (stillFailed.length === 0) continue;

            const failedCount = stillFailed.length;
            const severity = failedCount >= 3 ? 'critical' : 'warning';
            const detail = {
              category: 'criteria',
              type: item.observation.type,
              sourceKey: item.observation.sourceKey,
              failedCriteria: stillFailed.map((r) => ({
                criterion: r.key,
                expected: r.detail.expected,
                actual: r.detail.actual,
                message: r.detail.message,
              })),
              passedCount: 0,
              failedCount,
              severity,
              ...(item.suggestedAction ? { suggestedAction: item.suggestedAction } : {}),
            };
            const audit = await logAudit(tx, {
              orgId,
              actorId: LOOP_ACTOR,
              actorType: 'agent',
              action: CRITERIA_FLAG_ACTION,
              target: item.observation.externalRef,
              detail,
            });
            await createLoopFlagInTx(tx, {
              orgId,
              action: CRITERIA_FLAG_ACTION,
              target: item.observation.externalRef,
              category: 'criteria',
              type: item.observation.type,
              severity,
              detail,
              auditId: audit.id,
            });
            rows.push(audit);
          }
          return rows;
        });

  const allFlags = [...metricFlagRows.rows, ...toolFlagRows];

  // D) AFTER commit: notify best-effort.
  for (const row of allFlags) {
    await notifyFlag(orgId, toFlagView(row));
  }
  return allFlags.length;
}

export interface RunLoopTickOptions {
  /** Current time; injectable so tests can pin the window. Defaults to now. */
  now?: Date;
  /**
   * The per-org runner. Defaults to runLoopTickForOrg. Exposed ONLY so tests can
   * inject a failing tenant and assert the sweep isolates it — production always
   * uses the default.
   */
  runForOrg?: (orgId: string, since: Date) => Promise<number>;
}

/**
 * The full sweep: check every org's process metrics and raise deduped flags.
 * One tenant's failure is counted and skipped — the sweep runs to completion for
 * the rest (same resilience as runRetentionSweep).
 */
export async function runLoopTick(options: RunLoopTickOptions = {}): Promise<LoopTickResult> {
  const now = options.now ?? new Date();
  const runForOrg = options.runForOrg ?? runLoopTickForOrg;
  const since = new Date(now.getTime() - LOOP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT loop_org_ids() AS org_id
  `;

  let flagsRaised = 0;
  let failed = 0;
  for (const { org_id } of rows) {
    try {
      flagsRaised += await runForOrg(org_id, since);
    } catch (err) {
      failed += 1;
      logError('loop tick: tenant failed', err, { orgId: org_id });
    }
  }
  return { orgs: rows.length, flagsRaised, failed };
}
