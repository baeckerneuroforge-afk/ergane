import Link from 'next/link';
import { queryAuditLog } from '@/lib/audit';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { toFlagView } from '@/lib/loop/flags-view';
import { JsonView, formatDateTime } from '../ui';
import { CategoryChip, DeviationSummary, FlagSourceLink, SeverityChip } from './flag-cells';
import { CorrectButton } from './correct-button';

export const dynamic = 'force-dynamic';

// Flags are append-only audit rows whose action starts with 'flag.' (see
// loop-implementierungsplan.md §5, Stufe A). Reading them through
// queryAuditLog keeps the query inside withTenant — RLS-scoped, so this view
// can never widen beyond the caller's tenant.
const FLAG_PREFIX = 'flag.';
const PAGE_SIZE = 50;
// Schritt E: loop auto-correction events. Loaded alongside flags so a criteria
// flag can show whether the loop auto-started a correction for it (transparency),
// or whether the daily limit blocked one.
const AUTO_STARTED_ACTION = 'loop.auto_correction_started';
const AUTO_LIMIT_ACTION = 'loop.auto_correction_limit_reached';

/** Map a flag's source runId → the run the loop auto-started for it (if any). */
interface AutoCorrectionInfo {
  /** sourceRunId → the auto-started run's id. */
  started: Map<string, string>;
  /** sourceRunIds for which the daily limit blocked an auto-start. */
  limited: Set<string>;
}

function detailStr(detail: unknown, key: string): string | null {
  if (detail != null && typeof detail === 'object' && !Array.isArray(detail)) {
    const v = (detail as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Parse the auto-correction target `skillKey:runId` → the started runId. */
function targetRunId(target: string | null): string | null {
  if (!target) return null;
  const idx = target.lastIndexOf(':');
  return idx >= 0 ? target.slice(idx + 1) : null;
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const page = Math.max(1, Number.parseInt(p ?? '1', 10) || 1);

  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const f = t.flags;

  const result = await queryAuditLog(orgId, {
    actionPrefixes: [FLAG_PREFIX],
    page,
    pageSize: PAGE_SIZE,
  });
  const flags = result.entries.map(toFlagView);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  // Correlate loop auto-corrections with the flags ON THIS PAGE only: a
  // loop.auto_correction_started entry's detail.sourceRunId is the flag's own
  // runId, and its target `skillKey:runId` names the started run. We scope the
  // read to the visible flags' source runIds (not a blind newest-N window) so
  // the badge is correct on every page regardless of history size. RLS-scoped.
  const auto: AutoCorrectionInfo = { started: new Map(), limited: new Set() };
  const visibleRunIds = new Set(flags.map((v) => v.runId).filter((x): x is string => !!x));
  if (visibleRunIds.size > 0) {
    const autoEvents = await queryAuditLog(orgId, {
      actionPrefixes: [AUTO_STARTED_ACTION, AUTO_LIMIT_ACTION],
      pageSize: 200,
    });
    // Newest first (queryAuditLog orders by createdAt desc): keep the FIRST seen
    // per sourceRunId → the most recent auto-start.
    for (const e of autoEvents.entries) {
      const sourceRunId = detailStr(e.detail, 'sourceRunId');
      if (!sourceRunId || !visibleRunIds.has(sourceRunId)) continue;
      if (e.action === AUTO_STARTED_ACTION) {
        const startedRunId = targetRunId(e.target);
        if (startedRunId && !auto.started.has(sourceRunId)) auto.started.set(sourceRunId, startedRunId);
      } else if (e.action === AUTO_LIMIT_ACTION) {
        auto.limited.add(sourceRunId);
      }
    }
  }

  const pageHref = (target: number) =>
    target > 1 ? `/dashboard/flags?p=${target}` : '/dashboard/flags';

  return (
    <>
      <p className="audit-note">
        {f.note} ({f.entryCount(result.total)})
      </p>

      {flags.length === 0 ? (
        <div className="empty">
          <h3>{f.emptyTitle}</h3>
          <p>{f.emptyBody}</p>
        </div>
      ) : (
        <section className="card card--table">
          <table className="table">
            <thead>
              <tr>
                <th>{f.time}</th>
                <th>{f.flag}</th>
                <th>{f.severity}</th>
                <th>{f.deviation}</th>
                <th>{f.source}</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((view) => (
                <tr key={view.id}>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(view.createdAt, locale)}
                  </td>
                  <td>
                    <CategoryChip view={view} locale={locale} />
                    <div className="row-meta mono">{view.action}</div>
                    {view.suggestedAction ? (
                      <div className="row-meta">
                        <span className="chip chip--gray">{f.suggested}</span>{' '}
                        {view.suggestedAction}
                      </div>
                    ) : null}
                    {(() => {
                      const autoRunId = view.runId ? auto.started.get(view.runId) : undefined;
                      const wasLimited = view.runId ? auto.limited.has(view.runId) : false;
                      if (autoRunId) {
                        // The loop already auto-started a correction → show a badge
                        // + link to the started run; no manual button (redundant).
                        return (
                          <div className="row-meta" style={{ marginTop: '0.35rem' }}>
                            <span className="chip chip--indigo">{f.autoStarted}</span>{' '}
                            <Link href={`/dashboard/runs/${autoRunId}`}>{f.autoStartedRun}</Link>
                          </div>
                        );
                      }
                      if (wasLimited) {
                        // The daily limit blocked an auto-start → honest notice.
                        return (
                          <div className="row-meta" style={{ marginTop: '0.35rem' }}>
                            <span className="chip chip--amber">{f.autoLimitReached}</span>
                          </div>
                        );
                      }
                      // No auto-start (report/suggest, or autonomous not yet acted):
                      // offer the manual "start correction" button when there is a
                      // correction ref (suggest/autonomous flags).
                      return view.correction ? <CorrectButton correction={view.correction} /> : null;
                    })()}
                  </td>
                  <td>
                    <SeverityChip view={view} locale={locale} />
                    {view.deviations.length > 1 ? (
                      <div className="row-meta">{f.deviationCount(view.deviations.length)}</div>
                    ) : null}
                  </td>
                  <td>
                    <DeviationSummary view={view} locale={locale} max={3} />
                    {view.raw != null ? (
                      <details className="json-details">
                        <summary>{t.common.expand}</summary>
                        <JsonView value={view.raw} />
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <FlagSourceLink view={view} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {totalPages > 1 ? (
        <div className="filter-chips" style={{ marginTop: '0.6rem' }}>
          {page > 1 ? (
            <Link className="filter-chip" href={pageHref(page - 1)}>
              {t.audit.newer}
            </Link>
          ) : null}
          <span className="row-meta">{t.audit.page(page, totalPages)}</span>
          {page < totalPages ? (
            <Link className="filter-chip" href={pageHref(page + 1)}>
              {t.audit.older}
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
