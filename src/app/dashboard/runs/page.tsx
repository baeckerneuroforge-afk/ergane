import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { withTenant } from '@/lib/tenant';
import { RunStatusChip, SimulationBadge, amountOfInput, formatDateTime, formatEuro } from '../ui';
import { RUNS_PAGE_LIMIT } from './limits';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();

  // select: the list never shows `result` (can be a large JSON blob) — don't
  // pull 100 of them over the wire for a table of four columns.
  const runs = await withTenant(orgId, (tx) =>
    tx.skillRun.findMany({
      select: {
        id: true,
        skillKey: true,
        status: true,
        mode: true,
        input: true,
        createdAt: true,
        clientId: true,
        stepAttempts: true,
        claimUntil: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: RUNS_PAGE_LIMIT,
    }),
  );

  return (
    <>
      <section className="card card--table">
        {runs.length === 0 ? (
          <div className="empty" style={{ margin: '1rem 1.3rem' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 22a10 10 0 1 0-10-10M2 22l5-5M2 17v5h5" />
            </svg>
            <strong>{t.runs.emptyTitle}</strong>
            <span>
              {t.runs.emptyHintPrefix} <Link href="/dashboard/skills">{t.nav.skills}</Link>{' '}
              {t.runs.emptyHintSuffix}
            </span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.skill}</th>
                <th>{t.runs.colClient}</th>
                <th>{t.common.amount}</th>
                <th>{t.common.status}</th>
                <th>{t.runs.startedAt}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const amount = amountOfInput(run.input);
                return (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/dashboard/runs/${run.id}`}>
                        <span className="mono">{run.skillKey}</span>
                      </Link>
                      <div className="row-meta mono">{run.id.slice(0, 8)}…</div>
                    </td>
                    <td>
                      {run.client ? (
                        <Link href={`/dashboard/clients/${run.client.id}`}>{run.client.name}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono">{amount !== null ? formatEuro(amount, locale) : '—'}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <RunStatusChip status={run.status} locale={locale} />
                        {run.mode === 'simulation' ? <SimulationBadge locale={locale} /> : null}
                        {run.status === 'running' && (run.stepAttempts ?? 0) > 0 ? (
                          <span className="chip chip--amber" title="Durable retry / backoff">
                            {t.runs.retrying(run.stepAttempts)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(run.createdAt, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
