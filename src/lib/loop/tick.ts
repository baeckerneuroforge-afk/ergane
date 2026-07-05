// The periodic loop tick — the trend-driven flag trigger (Schritt C, plan §8).
//
// runLoopTick() is the cron path (route /api/cron/loop). The tenant list comes
// from loop_org_ids() (SECURITY DEFINER, migration 0025): every org, no context
// needed, ids only. For each org it opens ONE short withTenant() transaction and
// inside it:
//   1. computeLoopMetrics()  — fast DB reads only,
//   2. for each failed metric: a 24h dedup check, then logAudit() if new,
// ALL in that one transaction. A failing tenant is counted and skipped; it never
// stops the others (same contract as runRetentionSweep).
//
// THE NON-NEGOTIABLE RULE (checked): metrics + dedup + flag write share one short
// per-org tx; no LLM call, no slow external call — only DB reads and audit
// writes, well within the 15s budget.

import type { AuditLog } from '@prisma/client';
import { logAudit } from '../audit';
import { logError } from '../log';
import { prisma } from '../prisma';
import { withTenant, type Tx } from '../tenant';
import { toFlagView } from './flags-view';
import { buildMetricFlag, METRIC_FLAG_ACTION } from './metric-flags';
import { computeLoopMetrics } from './metrics';
import { notifyFlag } from './notify';
import { resolveAutonomyContext } from './settings';
import { buildMetricSuggestedActionText } from './suggest';

/** How far back the metric window reaches (plan §8: last 7 days). */
export const LOOP_WINDOW_DAYS = 7;

/**
 * Dedup horizon: a metric flag is not repeated within this window. Matched to
 * the cron cadence (once per day, vercel.json) so a daily tick never re-raises
 * the same metric flag it already raised on the previous run.
 */
export const DEDUP_HOURS = 24;

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
 * Run the metric check for one tenant and raise flags for deviations, with
 * dedup — all inside one short transaction. Returns how many NEW flags were
 * written. Throws only on an actual DB error (the caller isolates it).
 */
export async function runLoopTickForOrg(orgId: string, since: Date): Promise<number> {
  // The flag WRITES happen inside one short tx; the rows are collected so the
  // best-effort notification runs AFTER the commit (never inside the tx).
  const flagRows = await withTenant(orgId, async (tx) => {
    const { metrics } = await computeLoopMetrics(tx, orgId, { since });

    // Autonomy + locale: one fast read up front (not per metric). Under 'suggest'
    // (or 'autonomous', which behaves like it until Schritt E) each metric flag
    // carries a review-oriented suggestedAction; under 'report' it does not.
    // Metric flags never carry a re-run `correction` — see buildMetricFlag.
    const { locale, suggest } = await resolveAutonomyContext(tx, orgId);
    const suggestion = suggest ? buildMetricSuggestedActionText(locale) : undefined;

    const rows: AuditLog[] = [];
    for (const metric of metrics) {
      if (metric.passed) continue;
      // Dedup in the SAME tx, before writing — no duplicate within 24h.
      if (await hasRecentMetricFlag(tx, metric.key)) continue;
      rows.push(await logAudit(tx, buildMetricFlag(orgId, metric, suggestion)));
    }
    return rows;
  });

  // AFTER commit: notify per new flag, best-effort. notifyFlag never throws, so
  // one org's mail/Slack hiccup cannot fail its tick (and runLoopTick isolates a
  // tenant anyway). Returns the count of NEW flags for the sweep tally.
  //
  // NOTE (Schritt E): metric flags deliberately carry NO `correction` re-run
  // pointer — a process-metric trend has no single originating run to replay
  // (see buildMetricFlag / suggest.ts). So there is nothing to auto-start here,
  // even at autonomy 'autonomous': the cron tick only reports metric deviations.
  // Auto-correction applies solely to criteria flags (evaluate.ts), which DO
  // carry a concrete re-runnable run.
  for (const row of flagRows) {
    await notifyFlag(orgId, toFlagView(row));
  }
  return flagRows.length;
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
