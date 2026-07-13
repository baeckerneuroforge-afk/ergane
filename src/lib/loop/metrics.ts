// Process-metric aggregation for the periodic loop tick (Schritt C, plan §3).
//
// computeLoopMetrics() reduces a tenant's recent activity to four deterministic
// process metrics and compares each against a fixed threshold. It is the
// trend-driven counterpart to Schritt A's event-driven acceptance criteria:
// where criteria judge a single deliverable at the end of its run, these
// metrics watch aggregate behaviour over a window (e.g. "success rate slipped
// below 70% this week").
//
// THE NON-NEGOTIABLE RULE (checked): this runs INSIDE the caller's withTenant()
// transaction and does ONLY fast DB reads. No LLM call, no network call, no slow
// work — the whole thing must finish well within the 15s transaction budget. The
// cron route (src/app/api/cron/loop/route.ts) opens one short tx per org and
// calls this, then writes flags in the SAME tx.
//
// Thresholds are code constants for Phase 1 (no UI, no storage) — the same
// approach as DEFAULT_MINUTES_SAVED in src/lib/value.ts. They can later move to
// org_settings.loop_metric_thresholds (plan §3) without touching this signature.

import { computeValueStats } from '../value';
import type { Tx } from '../tenant';
import {
  parseMetricThresholdOverrides,
  resolveMetricThreshold,
  type MetricThresholdMap,
} from './thresholds';

function thr(key: LoopMetricKey, overrides: MetricThresholdMap) {
  return resolveMetricThreshold(key, METRIC_THRESHOLDS, overrides);
}

/** Which side of the threshold counts as healthy. */
export type MetricDirection = 'atLeast' | 'atMost';

/** Stable metric keys — also the audit `target` and detail.metric of a flag. */
export type LoopMetricKey =
  | 'success_rate'
  | 'approval_rate'
  | 'iteration_rate'
  | 'feedback_negative_rate'
  /** Share of open tickets (source=ticket) without AC markers in source_meta/title. */
  | 'open_tickets_without_acceptance'
  /** Share of open tickets with lastActivity older than stale threshold. */
  | 'stale_open_tickets'
  /** Share of code docs without a ticket reference in message/meta. */
  | 'commits_without_ticket'
  /** Share of done tickets with no code document referencing their identifier. */
  | 'tickets_done_without_commit';

export interface LoopMetric {
  key: LoopMetricKey;
  /**
   * The observed value, or null when there is no data to judge (e.g. no decided
   * runs yet). A null value NEVER fails — flagging an empty org would be a false
   * alarm, and alarm-fatigue is the biggest risk of this feature (plan §11).
   */
  value: number | null;
  /** The fixed Phase-1 threshold this value is compared against. */
  threshold: number;
  /** Whether healthy means value ≥ threshold ('atLeast') or ≤ ('atMost'). */
  direction: MetricDirection;
  /** True when the metric is within target (or has no data to judge). */
  passed: boolean;
  /** Structured context for the flag detail + the UI. */
  detail: {
    /** Human-readable one-liner ('Success rate 42% (target ≥ 70%)'). */
    message: string;
    /** Numerator/denominator when the metric is a rate — for transparency. */
    numerator?: number;
    denominator?: number;
    /** Worst offending group for iteration_rate (skill+client), when present. */
    worst?: { skillKey: string; clientId: string; runs: number };
  };
}

export interface LoopMetrics {
  since: Date;
  metrics: LoopMetric[];
}

// -----------------------------------------------------------------------------
// Thresholds (Phase 1 code constants — plan §3). Keep the direction next to the
// number so the comparison and the flag detail can never drift apart.
// -----------------------------------------------------------------------------

export const METRIC_THRESHOLDS: Record<
  LoopMetricKey,
  { threshold: number; direction: MetricDirection }
> = {
  success_rate: { threshold: 0.7, direction: 'atLeast' },
  approval_rate: { threshold: 0.6, direction: 'atLeast' },
  iteration_rate: { threshold: 3, direction: 'atMost' },
  feedback_negative_rate: { threshold: 0.15, direction: 'atMost' },
  // Conservative: flag only when a large share of open tickets lack AC / are stale.
  open_tickets_without_acceptance: { threshold: 0.5, direction: 'atMost' },
  stale_open_tickets: { threshold: 0.4, direction: 'atMost' },
  // Conservative: flag only when a large share of code lacks ticket links.
  commits_without_ticket: { threshold: 0.5, direction: 'atMost' },
  tickets_done_without_commit: { threshold: 0.5, direction: 'atMost' },
};

/** Days without activity for stale_open_tickets metric (aligned with ticket criteria). */
export const STALE_OPEN_TICKET_DAYS = 14;

const AC_MARKERS_SQL = [
  '%acceptance%criteria%',
  '%AC:%',
  '%Akzeptanzkriterien%',
];

function judge(value: number | null, threshold: number, direction: MetricDirection): boolean {
  if (value == null) return true; // no data → nothing to flag
  return direction === 'atLeast' ? value >= threshold : value <= threshold;
}

/**
 * Minimum sample size before rate metrics can fail. n=1 ⇒ 100% rates would
 * false-alarm young orgs (review finding: near-empty false alarms).
 */
export const MIN_METRIC_SAMPLES = 3;

function rateOrNull(numerator: number, total: number): number | null {
  if (total < MIN_METRIC_SAMPLES) return null;
  return total > 0 ? numerator / total : null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// -----------------------------------------------------------------------------
// The four metrics. Each is a small, sequential DB read on the caller's tx.
// Sequential (not Promise.all) on purpose: an interactive Prisma transaction is
// one pinned connection — concurrent queries on the same tx client are
// unsupported (see the note in src/lib/audit.ts / lifecycle export).
// -----------------------------------------------------------------------------

/** success_rate: completed / (completed + rejected + failed) live runs. */
async function successRate(
  tx: Tx,
  orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('success_rate', overrides);
  const stats = await computeValueStats(tx, orgId, { since });
  const value = stats.successRate; // null while nothing is decided
  const decided = stats.completedRuns + stats.rejectedOrFailedRuns;
  return {
    key: 'success_rate',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No decided live runs in the window — success rate not measurable yet.'
          : `Success rate ${pct(value)} (target ≥ ${pct(threshold)}).`,
      numerator: stats.completedRuns,
      denominator: decided,
    },
  };
}

/** approval_rate: approved / (approved + rejected) from the audit trail. */
async function approvalRate(
  tx: Tx,
  orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('approval_rate', overrides);
  // Sequential counts on the pinned tx connection.
  const approved = await tx.auditLog.count({
    where: { action: 'approval.approved', createdAt: { gte: since } },
  });
  const rejected = await tx.auditLog.count({
    where: { action: 'approval.rejected', createdAt: { gte: since } },
  });
  const total = approved + rejected;
  const value = total > 0 ? approved / total : null;
  return {
    key: 'approval_rate',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No approval decisions in the window — approval rate not measurable yet.'
          : `Approval rate ${pct(value)} (target ≥ ${pct(threshold)}).`,
      numerator: approved,
      denominator: total,
    },
  };
}

/**
 * iteration_rate: how many runs of the SAME skill for the SAME client it took
 * — the worst such group in the window. A client+skill that had to be re-run
 * many times signals a quality problem. We report the max group size; healthy
 * is ≤ 3. Only client-attributed live runs are grouped (clientId NOT NULL).
 */
async function iterationRate(
  tx: Tx,
  orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('iteration_rate', overrides);
  const runs = await tx.skillRun.findMany({
    where: { mode: 'live', clientId: { not: null }, createdAt: { gte: since } },
    select: { skillKey: true, clientId: true },
  });

  const groups = new Map<string, { skillKey: string; clientId: string; runs: number }>();
  for (const r of runs) {
    if (!r.clientId) continue; // narrows the type; the where already excludes null
    const gkey = `${r.skillKey}${r.clientId}`;
    const g = groups.get(gkey) ?? { skillKey: r.skillKey, clientId: r.clientId, runs: 0 };
    g.runs += 1;
    groups.set(gkey, g);
  }

  let worst: { skillKey: string; clientId: string; runs: number } | undefined;
  for (const g of groups.values()) {
    if (!worst || g.runs > worst.runs) worst = g;
  }
  // No grouped runs → no data (null), never a flag.
  const value = worst ? worst.runs : null;

  return {
    key: 'iteration_rate',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No client-attributed runs in the window — iteration rate not measurable yet.'
          : `Up to ${value} runs for the same client+skill (target ≤ ${threshold}).`,
      ...(worst ? { worst } : {}),
    },
  };
}

/** feedback_negative_rate: 👎 / (👍 + 👎) over chat_feedback in the window. */
async function feedbackNegativeRate(
  tx: Tx,
  orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('feedback_negative_rate', overrides);
  const down = await tx.chatFeedback.count({
    where: { verdict: 'down', createdAt: { gte: since } },
  });
  const up = await tx.chatFeedback.count({
    where: { verdict: 'up', createdAt: { gte: since } },
  });
  const total = up + down;
  const value = total > 0 ? down / total : null;
  return {
    key: 'feedback_negative_rate',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No chat feedback in the window — negative-feedback rate not measurable yet.'
          : `Negative feedback ${pct(value)} (target ≤ ${pct(threshold)}).`,
      numerator: down,
      denominator: total,
    },
  };
}

/**
 * Open tickets missing acceptance markers — uses title + source_meta text.
 * No data (zero open tickets) ⇒ null value ⇒ pass (no false alarm).
 */
async function openTicketsWithoutAcceptance(
  tx: Tx,
  _orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('open_tickets_without_acceptance', overrides);
  // Open ≈ state not in completed/canceled/done (source_meta.state).
  const openRows = await tx.$queryRaw<Array<{ total: bigint; missing: bigint }>>`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (
        WHERE NOT (
          COALESCE("title", '') ILIKE ${AC_MARKERS_SQL[0]}
          OR COALESCE("title", '') ILIKE ${AC_MARKERS_SQL[1]}
          OR COALESCE("title", '') ILIKE ${AC_MARKERS_SQL[2]}
          OR COALESCE("source_meta"->>'text', '') ILIKE ${AC_MARKERS_SQL[0]}
          OR COALESCE("source_meta"->>'text', '') ILIKE ${AC_MARKERS_SQL[1]}
          OR COALESCE("source_meta"->>'text', '') ILIKE ${AC_MARKERS_SQL[2]}
          OR COALESCE("source_meta"->>'description', '') ILIKE ${AC_MARKERS_SQL[0]}
          OR COALESCE("source_meta"->>'description', '') ILIKE ${AC_MARKERS_SQL[1]}
          OR COALESCE("source_meta"->>'description', '') ILIKE ${AC_MARKERS_SQL[2]}
        )
      )::bigint AS missing
    FROM "documents"
    WHERE "source" = 'ticket'
      AND "external_ref" IS NOT NULL
      AND "created_at" >= ${since}
      AND COALESCE(lower("source_meta"->>'state'), '') NOT IN ('completed', 'canceled', 'cancelled', 'done')
  `;
  const total = Number(openRows[0]?.total ?? 0n);
  const missing = Number(openRows[0]?.missing ?? 0n);
  const value = rateOrNull(missing, total);
  return {
    key: 'open_tickets_without_acceptance',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No open tickets in the window — AC coverage not measurable yet.'
          : `Open tickets without acceptance markers ${pct(value)} (target ≤ ${pct(threshold)}).`,
      numerator: missing,
      denominator: total,
    },
  };
}

async function staleOpenTickets(
  tx: Tx,
  _orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('stale_open_tickets', overrides);
  const rows = await tx.$queryRaw<Array<{ total: bigint; stale: bigint }>>`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (
        WHERE COALESCE(
          CASE
            WHEN "source_meta"->>'lastActivityAt' ~ '^[0-9]{4}-'
              THEN ("source_meta"->>'lastActivityAt')::timestamptz
            ELSE NULL
          END,
          "created_at"
        ) < now() - (${STALE_OPEN_TICKET_DAYS} * interval '1 day')
      )::bigint AS stale
    FROM "documents"
    WHERE "source" = 'ticket'
      AND "external_ref" IS NOT NULL
      AND "created_at" >= ${since}
      AND COALESCE(lower("source_meta"->>'state'), '') NOT IN ('completed', 'canceled', 'cancelled', 'done')
  `;
  const total = Number(rows[0]?.total ?? 0n);
  const stale = Number(rows[0]?.stale ?? 0n);
  const value = rateOrNull(stale, total);
  return {
    key: 'stale_open_tickets',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No open tickets in the window — stale rate not measurable yet.'
          : `Stale open tickets ${pct(value)} (target ≤ ${pct(threshold)}).`,
      numerator: stale,
      denominator: total,
    },
  };
}

/**
 * Compute process metrics for one tenant, for runs/events at/after `since`.
 * MUST be called inside a withTenant() transaction (RLS scopes every read to
 * `orgId`). Fast DB reads only — no LLM, no network.
 *
 * When `thresholdOverrides` is omitted, loads org_settings.loop_metric_thresholds
 * (NULL ⇒ code defaults). Pass an explicit map in tests to pin overrides.
 */
export async function computeLoopMetrics(
  tx: Tx,
  orgId: string,
  { since, thresholdOverrides }: { since: Date; thresholdOverrides?: MetricThresholdMap },
): Promise<LoopMetrics> {
  let overrides = thresholdOverrides;
  if (overrides === undefined) {
    const row = await tx.orgSettings.findUnique({
      where: { orgId },
      select: { loopMetricThresholds: true },
    });
    overrides = parseMetricThresholdOverrides(row?.loopMetricThresholds);
  }

  // Sequential: one pinned connection per interactive transaction.
  const metrics: LoopMetric[] = [
    await successRate(tx, orgId, since, overrides),
    await approvalRate(tx, orgId, since, overrides),
    await iterationRate(tx, orgId, since, overrides),
    await feedbackNegativeRate(tx, orgId, since, overrides),
    await openTicketsWithoutAcceptance(tx, orgId, since, overrides),
    await staleOpenTickets(tx, orgId, since, overrides),
    await commitsWithoutTicket(tx, orgId, since, overrides),
    await ticketsDoneWithoutCommit(tx, orgId, since, overrides),
  ];
  return { since, metrics };
}

/** Share of code documents whose message has no ticket ref (P2-B). */
async function commitsWithoutTicket(
  tx: Tx,
  _orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('commits_without_ticket', overrides);
  const rows = await tx.$queryRaw<Array<{ total: bigint; missing: bigint }>>`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (
        WHERE NOT (
          lower(COALESCE("source_meta"->>'hasTicketRef', '')) IN ('true', 't', '1')
          OR COALESCE("source_meta"->>'message', "title", '') ~* '[A-Z][A-Z0-9]+-[0-9]+'
        )
      )::bigint AS missing
    FROM "documents"
    WHERE "source" = 'code'
      AND "external_ref" IS NOT NULL
      AND "created_at" >= ${since}
  `;
  const total = Number(rows[0]?.total ?? 0n);
  const missing = Number(rows[0]?.missing ?? 0n);
  const value = rateOrNull(missing, total);
  return {
    key: 'commits_without_ticket',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? 'No code documents in the window — commit/ticket link rate not measurable yet.'
          : `Commits/PRs without ticket ref ${pct(value)} (target ≤ ${pct(threshold)}).`,
      numerator: missing,
      denominator: total,
    },
  };
}

/**
 * Done tickets whose identifier does not appear in any code document's
 * ticketRefs / text. Conservative: only counts tickets with an identifier in
 * source_meta.
 */
async function ticketsDoneWithoutCommit(
  tx: Tx,
  _orgId: string,
  since: Date,
  overrides: MetricThresholdMap,
): Promise<LoopMetric> {
  const { threshold, direction } = thr('tickets_done_without_commit', overrides);
  const tickets = await tx.document.findMany({
    where: {
      source: 'ticket',
      externalRef: { not: null },
      createdAt: { gte: since },
    },
    select: { sourceMeta: true, title: true },
    take: 200,
  });

  const doneTickets: string[] = [];
  for (const t of tickets) {
    const meta =
      t.sourceMeta && typeof t.sourceMeta === 'object' && !Array.isArray(t.sourceMeta)
        ? (t.sourceMeta as Record<string, unknown>)
        : {};
    const state = String(meta.state ?? '').toLowerCase();
    if (!['completed', 'done', 'canceled', 'cancelled'].includes(state)) continue;
    if (state === 'canceled' || state === 'cancelled') continue;
    const id =
      (typeof meta.identifier === 'string' && meta.identifier) ||
      (typeof meta.issueId === 'string' && meta.issueId) ||
      null;
    if (id) doneTickets.push(id);
  }

  if (doneTickets.length === 0) {
    return {
      key: 'tickets_done_without_commit',
      value: null,
      threshold,
      direction,
      passed: true,
      detail: {
        message: 'No completed tickets with identifiers in the window — not measurable yet.',
      },
    };
  }

  const codeDocs = await tx.document.findMany({
    where: { source: 'code', externalRef: { not: null }, createdAt: { gte: since } },
    select: { sourceMeta: true, title: true },
    take: 500,
  });

  let linked = 0;
  for (const id of doneTickets) {
    const needle = id.toUpperCase();
    const found = codeDocs.some((d) => {
      const meta =
        d.sourceMeta && typeof d.sourceMeta === 'object' && !Array.isArray(d.sourceMeta)
          ? (d.sourceMeta as Record<string, unknown>)
          : {};
      const refs = Array.isArray(meta.ticketRefs)
        ? meta.ticketRefs.map((r) => String(r).toUpperCase())
        : [];
      if (refs.includes(needle)) return true;
      const text = `${d.title} ${typeof meta.text === 'string' ? meta.text : ''} ${typeof meta.message === 'string' ? meta.message : ''}`;
      return text.toUpperCase().includes(needle);
    });
    if (found) linked++;
  }

  const missing = doneTickets.length - linked;
  const value = rateOrNull(missing, doneTickets.length);
  return {
    key: 'tickets_done_without_commit',
    value,
    threshold,
    direction,
    passed: judge(value, threshold, direction),
    detail: {
      message:
        value == null
          ? `Fewer than ${MIN_METRIC_SAMPLES} completed tickets — not measurable yet.`
          : `Completed tickets without linked commit ${pct(value)} (target ≤ ${pct(threshold)}).`,
      numerator: missing,
      denominator: doneTickets.length,
    },
  };
}
