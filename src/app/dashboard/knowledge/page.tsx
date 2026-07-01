import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { withTenant } from '@/lib/tenant';
import { addDocument } from './actions';

// Touches the session and tenant data → always dynamic.
export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const { userId, clerkOrgId, orgId, orgSlug, role } = await requireTenant();

  await ensureOrgAndMembership({
    clerkOrgId,
    name: orgSlug ?? clerkOrgId,
    userId,
    role,
  });

  // Every tenant read goes through withTenant — RLS scopes this to `orgId`.
  const documents = await withTenant(orgId, (tx) =>
    tx.document.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    }),
  );

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section>
        <h1>Knowledge base</h1>
        <p className="muted">
          Tenant <code>{orgSlug ?? clerkOrgId}</code>. Documents are chunked, embedded and stored
          per organization — the database enforces the isolation.{' '}
          <Link href="/dashboard/chat">Ask questions in the chat →</Link>
        </p>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Add document</h2>
        <form action={addDocument}>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" placeholder="e.g. Vacation policy 2026" required />
          <label htmlFor="text">Text</label>
          <textarea id="text" name="text" rows={6} placeholder="Paste the knowledge here…" />
          <label htmlFor="file">…or upload a .txt file (read server-side)</label>
          <input id="file" name="file" type="file" accept=".txt,text/plain" />
          <button type="submit">Ingest</button>
        </form>
      </section>

      <section>
        <h2>Documents ({documents.length})</h2>
        {documents.length === 0 ? (
          <p className="muted">No documents yet. Add the first one above.</p>
        ) : (
          <ul className="items">
            {documents.map((doc) => (
              <li key={doc.id}>
                <strong>{doc.title}</strong>
                <div className="muted">
                  {doc.source} · {doc._count.chunks} chunk{doc._count.chunks === 1 ? '' : 's'} ·{' '}
                  {doc.createdAt.toISOString().slice(0, 10)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
