import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { withTenant } from '@/lib/tenant';
import { RunStatusChip, formatDateTime } from '../ui';
import { CLIENTS_PAGE_LIMIT } from './limits';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const cl = t.clients;

  const clients = await withTenant(orgId, (tx) =>
    tx.client.findMany({
      select: {
        id: true,
        name: true,
        notes: true,
        _count: { select: { artifacts: true, skillRuns: true } },
        skillRuns: {
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
      take: CLIENTS_PAGE_LIMIT,
    }),
  );

  return (
    <>
      <p className="page-intro">
        {cl.intro}{' '}
        <Link href="/dashboard/settings?tab=clients">{cl.introSettingsLink}</Link>.
      </p>

      {clients.length === 0 ? (
        <div className="empty">
          <p>
            {cl.noClients}{' '}
            <Link href="/dashboard/settings?tab=clients">{cl.noClientsLink}</Link>.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{cl.colName}</th>
                <th>{cl.colRuns}</th>
                <th>{cl.colDeliverables}</th>
                <th>{cl.colLastActivity}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const lastRun = c.skillRuns[0];
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c._count.skillRuns}</td>
                    <td>{c._count.artifacts}</td>
                    <td>
                      {lastRun ? (
                        <span>
                          <RunStatusChip status={lastRun.status} locale={locale} />
                          <span className="mono row-meta" style={{ marginLeft: '0.4rem' }}>
                            {formatDateTime(lastRun.createdAt, locale)}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/dashboard/clients/${c.id}`} className="btn btn--small">
                        {cl.detail}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
