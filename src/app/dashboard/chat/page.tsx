import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { LEGACY_NO_KNOWLEDGE_ANSWERS, NO_KNOWLEDGE_ANSWER, SOURCES_MARKERS } from '@/lib/rag';
import { withTenant } from '@/lib/tenant';
import { getFeedbackStats, getOwnFeedback } from '@/lib/rag';
import { askQuestion, rateAnswer } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Split a persisted assistant message into answer text + source titles.
 * Canonical format (see src/lib/rag/answer.ts): the grounded answer ends with
 * one line `Sources: <title1>, <title2>, …` — rendered here as source chips,
 * never as running text (no double display). Messages persisted before the
 * English default used `Quellen:`; both markers parse (SOURCES_MARKERS).
 */
function splitSources(content: string): { text: string; sources: string[] } {
  for (const marker of SOURCES_MARKERS) {
    const idx = content.lastIndexOf(`\n\n${marker} `);
    if (idx === -1) continue;
    return {
      text: content.slice(0, idx),
      sources: content
        .slice(idx + marker.length + 3)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  return { text: content, sources: [] };
}

/** Honest no-knowledge answer, current or persisted legacy wording. */
function isNoKnowledge(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === NO_KNOWLEDGE_ANSWER || LEGACY_NO_KNOWLEDGE_ANSWERS.includes(trimmed);
}

export default async function ChatPage() {
  const { orgId, userId } = await requireTenant();
  const { t } = await getI18n();
  const c = t.chat;

  // Last 50 messages of THIS USER in THIS tenant. Per-actor since 0010: chat
  // answers can contain role-gated knowledge, so showing the whole org's
  // history would leak a lead's confidential answers to members. Pre-0010
  // rows (actor_id NULL) stay hidden — fail-closed.
  const messages = (
    await withTenant(orgId, (tx) =>
      tx.chatMessage.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    )
  ).reverse();

  // Feedback: the caller's own votes (active-button state) + org-wide counts.
  // Independent reads in separate withTenant transactions → run them in parallel.
  const [ownVotes, stats] = await Promise.all([
    getOwnFeedback(
      orgId,
      userId,
      messages.filter((m) => m.role === 'assistant').map((m) => m.id),
    ),
    getFeedbackStats(orgId),
  ]);

  return (
    <div className="chat-page">
      <p className="page-intro">
        {c.intro} <Link href="/dashboard/knowledge">{c.introKnowledgeLink}</Link> {c.introSuffix}
        {stats.up + stats.down > 0 ? (
          <span className="row-meta"> · {c.feedbackSoFar(stats.up, stats.down)}</span>
        ) : null}
      </p>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          <div className="empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />
            </svg>
            <strong>{c.emptyTitle}</strong>
            <span>{c.emptyHint}</span>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="bubble bubble--user">
                  {msg.content}
                </div>
              );
            }
            const { text, sources } = splitSources(msg.content);
            const noKnowledge = isNoKnowledge(text);
            return (
              <div
                key={msg.id}
                className={`bubble bubble--assistant${noKnowledge ? ' bubble--empty' : ''}`}
              >
                {text}
                {sources.length > 0 ? (
                  <div className="bubble-sources">
                    {sources.map((s) => (
                      <span key={s} className="chip chip--indigo">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="bubble-sources" aria-label={c.rateAria}>
                  {(['up', 'down'] as const).map((verdict) => (
                    <form key={verdict} action={rateAnswer} style={{ display: 'inline-block' }}>
                      <input type="hidden" name="messageId" value={msg.id} />
                      <input type="hidden" name="verdict" value={verdict} />
                      <button
                        type="submit"
                        className="btn btn--ghost select--inline"
                        title={verdict === 'up' ? c.helpful : c.notHelpful}
                        style={ownVotes[msg.id] === verdict ? { fontWeight: 700 } : undefined}
                      >
                        {verdict === 'up' ? '👍' : '👎'}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-input">
        <form action={askQuestion}>
          <input
            name="question"
            placeholder={c.questionPlaceholder}
            aria-label={c.questionAria}
            autoComplete="off"
            required
          />
          <button type="submit" className="btn btn--primary">
            {c.ask}
          </button>
        </form>
      </div>
    </div>
  );
}
