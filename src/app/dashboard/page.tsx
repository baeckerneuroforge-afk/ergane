import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { withTenant } from '@/lib/tenant';
import { createKnowledgeItem } from './actions';

// Touches the session and tenant data → always dynamic.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { userId, clerkOrgId, orgId, orgSlug, role } = await requireTenant();

  // Mirror the Clerk org + caller's membership into our DB (idempotent).
  await ensureOrgAndMembership({
    clerkOrgId,
    name: orgSlug ?? clerkOrgId,
    userId,
    role,
  });

  // Every tenant read goes through withTenant — RLS scopes this to `orgId`.
  const items = await withTenant(orgId, (tx) =>
    tx.knowledgeItem.findMany({ orderBy: { createdAt: 'desc' } }),
  );

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section>
        <h1>Knowledge items</h1>
        <p className="muted">
          Tenant <code>{orgSlug ?? clerkOrgId}</code> · you are <code>{role}</code>. Everything
          below is scoped to this organization by the database, not by this page.
        </p>
        <p className="muted">
          Phase 2: <Link href="/dashboard/knowledge">Knowledge base</Link> ·{' '}
          <Link href="/dashboard/chat">Knowledge chat</Link>
        </p>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>New item</h2>
        <form action={createKnowledgeItem}>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" placeholder="e.g. Onboarding checklist" required />
          <label htmlFor="body">Body</label>
          <textarea id="body" name="body" rows={3} placeholder="Details…" />
          <button type="submit">Create</button>
        </form>
      </section>

      <section>
        <h2>This organization&apos;s items ({items.length})</h2>
        {items.length === 0 ? (
          <p className="muted">No items yet. Create the first one above.</p>
        ) : (
          <ul className="items">
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.body ? <div className="muted">{item.body}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
