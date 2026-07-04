import { requireTenant } from '@/lib/auth-context';
import { listArtifacts } from '@/lib/artifacts';
import { listClients } from '@/lib/clients';
import { getI18n } from '@/lib/i18n/server';
import { removeArtifact } from './actions';

export const dynamic = 'force-dynamic';

export default async function DeliverablesPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { orgId } = await requireTenant();
  const { t } = await getI18n();
  const d = t.deliverables;
  const params = await searchParams;
  const filterClientId = params.clientId ?? null;

  const [artifacts, clients] = await Promise.all([
    listArtifacts(orgId, filterClientId),
    listClients(orgId),
  ]);

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <>
      <p className="page-intro">{d.intro}</p>

      {clients.length > 0 ? (
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="client-filter">{d.filterClient}</label>
          <form method="GET" style={{ display: 'inline' }}>
            <select
              id="client-filter"
              name="clientId"
              defaultValue={filterClientId ?? ''}
              style={{ marginLeft: '0.5rem' }}
            >
              <option value="">{d.filterAll}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="submit" className="btn btn--small" style={{ marginLeft: '0.5rem' }}>
              {t.common.filter}
            </button>
          </form>
        </div>
      ) : null}

      {artifacts.length === 0 ? (
        <p className="muted">{d.noArtifacts}</p>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{d.colTitle}</th>
                <th>{d.colType}</th>
                <th>{d.colClient}</th>
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
                  <td>{a.clientId ? clientMap.get(a.clientId) ?? '—' : '—'}</td>
                  <td>{d.versionLabel(a.version)}</td>
                  <td>{d.sizeKb(Math.ceil(a.sizeBytes / 1024))}</td>
                  <td>{a.createdAt.toLocaleDateString()}</td>
                  <td style={{ display: 'flex', gap: '0.5rem' }}>
                    <a
                      href={`/api/artifacts/${a.id}/download`}
                      className="btn btn--small"
                    >
                      {d.download}
                    </a>
                    <form action={removeArtifact}>
                      <input type="hidden" name="artifactId" value={a.id} />
                      <button
                        type="submit"
                        className="btn btn--small btn--danger"
                        title={d.deleteConfirm}
                      >
                        {t.common.delete}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
