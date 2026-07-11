import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { withTenant } from '@/lib/tenant';
import { isUuid } from '@/lib/uuid';
import { RunStatusChip, formatDateTime } from '../../ui';
import { CLIENT_DETAIL_ARTIFACTS_LIMIT, CLIENT_DETAIL_RUNS_LIMIT } from '../limits';

export const dynamic = 'force-dynamic';

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const cl = t.clients;
  const d = t.deliverables;
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const data = await withTenant(orgId, async (tx) => {
    const client = await tx.client.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        notes: true,
        createdAt: true,
      },
    });
    if (!client) return null;

    const [runs, artifacts] = await Promise.all([
      tx.skillRun.findMany({
        where: { clientId: id },
        select: { id: true, skillKey: true, status: true, createdAt: true, mode: true },
        orderBy: { createdAt: 'desc' },
        take: CLIENT_DETAIL_RUNS_LIMIT,
      }),
      tx.artifact.findMany({
        where: { clientId: id },
        select: { id: true, title: true, type: true, version: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: CLIENT_DETAIL_ARTIFACTS_LIMIT,
      }),
    ]);

    return { client, runs, artifacts };
  });

  if (!data) notFound();

  const { client, runs, artifacts } = data;

  return (
    <>
      <section className="card">
        <h2>{client.name}</h2>
        {client.notes ? (
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            <strong>{cl.notes}: </strong>{client.notes}
          </p>
        ) : null}
        <p className="mono row-meta" style={{ marginTop: '0.4rem' }}>
          {formatDateTime(client.createdAt, locale)}
        </p>
      </section>

      {/* --- Runs --- */}
      <section className="card card--table">
        <div className="card-title">
          <h2>{cl.runsTitle}</h2>
        </div>
        {runs.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>{cl.noRuns}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.skill}</th>
                <th>{t.common.status}</th>
                <th>{t.common.date}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/dashboard/runs/${r.id}`}>
                      <span className="chip chip--indigo">{r.skillKey}</span>
                    </Link>
                  </td>
                  <td><RunStatusChip status={r.status} locale={locale} /></td>
                  <td className="mono row-meta">{formatDateTime(r.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Deliverables --- */}
      <section className="card card--table">
        <div className="card-title">
          <h2>{cl.deliverablesTitle}</h2>
        </div>
        {artifacts.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>{cl.noDeliverables}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{d.colTitle}</th>
                <th>{d.colType}</th>
                <th>{d.colVersion}</th>
                <th>{d.colSize}</th>
                <th>{d.colDate}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong></td>
                  <td><span className="chip">{a.type}</span></td>
                  <td>{d.versionLabel(a.version)}</td>
                  <td>{d.sizeKb(Math.ceil(a.sizeBytes / 1024))}</td>
                  <td className="mono row-meta">{a.createdAt.toLocaleDateString()}</td>
                  <td>
                    <a href={`/api/artifacts/${a.id}/download`} className="btn btn--small">
                      {d.download}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
