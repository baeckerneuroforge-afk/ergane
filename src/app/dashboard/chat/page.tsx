import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { SOURCES_MARKER } from '@/lib/rag';
import { withTenant } from '@/lib/tenant';
import { askQuestion } from './actions';

// Touches the session and tenant data → always dynamic.
export const dynamic = 'force-dynamic';

/** Split a persisted assistant message into answer text + source titles. */
function splitSources(content: string): { text: string; sources: string[] } {
  const idx = content.lastIndexOf(`\n\n${SOURCES_MARKER} `);
  if (idx === -1) return { text: content, sources: [] };
  return {
    text: content.slice(0, idx),
    sources: content
      .slice(idx + SOURCES_MARKER.length + 3)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export default async function ChatPage() {
  const { userId, clerkOrgId, orgId, orgSlug, role } = await requireTenant();

  await ensureOrgAndMembership({
    clerkOrgId,
    name: orgSlug ?? clerkOrgId,
    userId,
    role,
  });

  // Last 50 messages of THIS tenant — via withTenant, enforced by RLS.
  const messages = (
    await withTenant(orgId, (tx) =>
      tx.chatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    )
  ).reverse();

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section>
        <h1>Knowledge chat</h1>
        <p className="muted">
          Answers come only from this organization&apos;s{' '}
          <Link href="/dashboard/knowledge">knowledge base</Link>, with sources. Without matching
          knowledge the assistant honestly says so.
        </p>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '0.75rem' }}>
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No messages yet. Ask the first question below.
          </p>
        ) : (
          messages.map((msg) => {
            const { text, sources } = msg.role === 'assistant'
              ? splitSources(msg.content)
              : { text: msg.content, sources: [] };
            return (
              <div key={msg.id}>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
                {sources.length > 0 ? (
                  <ul className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    {sources.map((s) => (
                      <li key={s}>Quelle: {s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      <section className="panel">
        <form action={askQuestion}>
          <label htmlFor="question">Your question</label>
          <input
            id="question"
            name="question"
            placeholder="e.g. How many vacation days do we have?"
            required
          />
          <button type="submit">Ask</button>
        </form>
      </section>
    </div>
  );
}
