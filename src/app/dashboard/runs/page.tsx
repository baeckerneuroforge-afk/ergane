import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { withTenant } from '@/lib/tenant';
import { RunStatusChip, amountOfInput, formatDateTime, formatEuro } from '../ui';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const { orgId } = await requireTenant();

  const runs = await withTenant(orgId, (tx) =>
    tx.skillRun.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  );

  return (
    <>
      <p className="page-intro">
        Jede Skill-Ausführung mit Status und Betrag. Details inklusive Step-Timeline per Klick.
      </p>

      <section className="card card--table">
        {runs.length === 0 ? (
          <p className="muted" style={{ padding: '0.8rem 1.25rem' }}>
            Noch keine Ausführungen. Starte einen Skill unter{' '}
            <Link href="/dashboard/skills">Skills</Link>.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Betrag</th>
                <th>Status</th>
                <th>Gestartet am</th>
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
                    <td className="mono">{amount !== null ? formatEuro(amount) : '—'}</td>
                    <td>
                      <RunStatusChip status={run.status} />
                    </td>
                    <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(run.createdAt)}
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
