import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { withTenant } from '@/lib/tenant';
import { VisibilityBadge, formatDateTime } from '../ui';
import { addDocument, changeVisibility } from './actions';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const { orgId, role } = await requireTenant();
  const isAdmin = role === 'admin' || role === 'owner';

  // Every tenant read goes through withTenant — RLS scopes this to `orgId`.
  const documents = await withTenant(orgId, (tx) =>
    tx.document.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    }),
  );

  return (
    <>
      <p className="page-intro">
        Dokumente werden pro Organisation gechunkt, eingebettet und gespeichert — die Isolation
        erzwingt die Datenbank. Fragen beantwortet der{' '}
        <Link href="/dashboard/chat">Chat</Link> ausschließlich aus diesem Wissen.
      </p>

      <section className="card">
        <h2>Dokument anlegen</h2>
        <form action={addDocument}>
          <label htmlFor="title">Titel</label>
          <input id="title" name="title" placeholder="z. B. Urlaubsrichtlinie 2026" required />
          <label htmlFor="text">Text</label>
          <textarea id="text" name="text" rows={5} placeholder="Wissen hier einfügen…" />
          <label htmlFor="file">…oder .txt-Datei hochladen (serverseitig gelesen)</label>
          <input id="file" name="file" type="file" accept=".txt,text/plain" />
          <label htmlFor="visibility">Sichtbarkeit</label>
          <select id="visibility" name="visibility" defaultValue="open">
            <option value="open">open — alle Rollen</option>
            <option value="restricted">restricted — nur berechtigte Rollen</option>
            <option value="confidential">confidential — nur berechtigte Rollen</option>
          </select>
          <button type="submit" className="btn btn--primary">
            Ingestieren
          </button>
        </form>
      </section>

      <section className="card card--table">
        <h2 style={{ padding: '0.8rem 1.25rem 0' }}>Dokumente ({documents.length})</h2>
        {documents.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.25rem 0.8rem' }}>
            Noch keine Dokumente. Lege oben das erste an.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Sichtbarkeit</th>
                <th>Datum</th>
                <th>Chunks</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div className="row-meta">{doc.source}</div>
                  </td>
                  <td>
                    <VisibilityBadge visibility={doc.visibility} />
                    {isAdmin ? (
                      <form
                        action={changeVisibility}
                        style={{ display: 'inline-block', marginLeft: '0.5rem' }}
                      >
                        <input type="hidden" name="documentId" value={doc.id} />
                        <select
                          name="visibility"
                          defaultValue={doc.visibility}
                          className="select--inline"
                        >
                          <option value="open">open</option>
                          <option value="restricted">restricted</option>
                          <option value="confidential">confidential</option>
                        </select>{' '}
                        <button type="submit" className="btn btn--ghost select--inline">
                          Ändern
                        </button>
                      </form>
                    ) : null}
                  </td>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(doc.createdAt)}
                  </td>
                  <td className="mono">{doc._count.chunks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
