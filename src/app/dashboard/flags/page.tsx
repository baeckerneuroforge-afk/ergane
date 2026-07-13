import Link from 'next/link';
import type { LoopFlagStatus } from '@prisma/client';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { listLoopFlags } from '@/lib/loop/flags';
import { toFlagView } from '@/lib/loop/flags-view';
import type { AuditLog } from '@prisma/client';
import { JsonView, formatDateTime } from '../ui';
import { CategoryChip, DeviationSummary, FlagSourceLink, SeverityChip } from './flag-cells';
import { CorrectButton } from './correct-button';
import { updateFlagStatus } from './actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const STATUSES: Array<LoopFlagStatus | 'all'> = ['all', 'open', 'acked', 'resolved'];

/** Project a loop_flags row through toFlagView by shaping it like an audit entry. */
function loopFlagToView(row: {
  id: string;
  createdAt: Date;
  action: string;
  target: string | null;
  category: string;
  severity: string;
  type: string | null;
  detail: unknown;
}) {
  const fakeAudit = {
    id: row.id,
    orgId: '',
    actorId: 'loop-engine',
    actorType: 'agent' as const,
    action: row.action,
    target: row.target,
    detail: {
      ...(row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
        ? (row.detail as object)
        : {}),
      category: row.category,
      severity: row.severity,
      type: row.type,
    },
    createdAt: row.createdAt,
  } as AuditLog;
  return toFlagView(fakeAudit);
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; status?: string }>;
}) {
  const { p, status: statusParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(p ?? '1', 10) || 1);
  const statusFilter = (STATUSES.find((s) => s === statusParam) ?? 'all') as
    | LoopFlagStatus
    | 'all';

  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const f = t.flags;

  const result = await listLoopFlags(orgId, {
    status: statusFilter,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <>
      <p className="page-intro">{f.note}</p>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        {f.entryCount(result.total)}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/dashboard/flags' : `/dashboard/flags?status=${s}`}
            className={`chip${statusFilter === s ? ' chip--green' : ''}`}
          >
            {s === 'all'
              ? f.filterAll
              : s === 'open'
                ? f.statusOpen
                : s === 'acked'
                  ? f.statusAcked
                  : f.statusResolved}
          </Link>
        ))}
      </div>

      {result.entries.length === 0 ? (
        <section className="card">
          <h2 style={{ margin: '1rem 1.2rem 0.4rem' }}>{f.emptyTitle}</h2>
          <p className="muted" style={{ margin: '0 1.2rem 1.2rem' }}>
            {f.emptyBody}
          </p>
        </section>
      ) : (
        <section className="card card--table">
          <table className="table">
            <thead>
              <tr>
                <th>{f.time}</th>
                <th>{f.status}</th>
                <th>{f.severity}</th>
                <th>{f.categoryCol}</th>
                <th>{f.target}</th>
                <th>{f.deviations}</th>
                <th>{f.actions}</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((row) => {
                const view = loopFlagToView(row);
                return (
                  <tr key={row.id}>
                    <td className="row-meta mono">{formatDateTime(row.createdAt, locale)}</td>
                    <td>
                      <span className="chip">{row.status}</span>
                    </td>
                    <td>
                      <SeverityChip view={view} locale={locale} />
                    </td>
                    <td>
                      <CategoryChip view={view} locale={locale} />
                    </td>
                    <td>
                      <FlagSourceLink view={view} locale={locale} />
                    </td>
                    <td>
                      <DeviationSummary view={view} locale={locale} />
                      {view.suggestedAction ? (
                        <div className="row-meta" style={{ marginTop: '0.35rem' }}>
                          {view.suggestedAction}
                        </div>
                      ) : null}
                      {view.correction && row.status !== 'resolved' ? (
                        <CorrectButton correction={view.correction} />
                      ) : null}
                      <details style={{ marginTop: '0.35rem' }}>
                        <summary className="row-meta" style={{ cursor: 'pointer' }}>
                          JSON
                        </summary>
                        <JsonView value={row.detail} />
                      </details>
                    </td>
                    <td>
                      <form action={updateFlagStatus} style={{ display: 'flex', gap: '0.35rem' }}>
                        <input type="hidden" name="flagId" value={row.id} />
                        {row.status !== 'acked' ? (
                          <button type="submit" name="status" value="acked" className="btn">
                            {f.ack}
                          </button>
                        ) : null}
                        {row.status !== 'resolved' ? (
                          <button type="submit" name="status" value="resolved" className="btn">
                            {f.resolve}
                          </button>
                        ) : null}
                        {row.status !== 'open' ? (
                          <button type="submit" name="status" value="open" className="btn">
                            {f.reopen}
                          </button>
                        ) : null}
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div style={{ padding: '0.8rem 1.2rem', display: 'flex', gap: '0.75rem' }}>
              {page > 1 ? (
                <Link
                  href={`/dashboard/flags?p=${page - 1}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`}
                >
                  ←
                </Link>
              ) : null}
              <span className="row-meta">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/dashboard/flags?p=${page + 1}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`}
                >
                  →
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
