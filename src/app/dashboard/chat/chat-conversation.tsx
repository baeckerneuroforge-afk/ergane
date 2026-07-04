'use client';

// Live send feedback for the RAG chat.
//
// The message list itself stays SERVER-rendered (passed in as `children`): it
// carries answer-trace parsing, source chips, relevance labels and the feedback
// forms — none of which we want to reimplement on the client. This wrapper only
// adds what the server round-trip can't: the instant an answer is submitted it
// (1) shows the user's question as an optimistic bubble, (2) shows a "helix is
// thinking" indicator where the answer will appear, and (3) puts the input +
// button into a busy state so a second submit can't race the first.
//
// askAction is the unchanged server action (actions.ts). It persists both
// messages and revalidates the route, so when the transition settles the real
// bubbles arrive via `children` and the optimistic tail is dropped in the same
// commit — no duplicate flash. On failure we surface a quiet error line and
// restore the typed question so the user can retry.
import { useRef, useState, useTransition } from 'react';
import { useDict } from '@/lib/i18n/client';

export function ChatConversation({
  children,
  emptyState,
  askAction,
  isEmpty,
}: {
  /** Server-rendered message bubbles (empty when there is no history). */
  children: React.ReactNode;
  /** Server-rendered empty-state, shown only while there is nothing else. */
  emptyState: React.ReactNode;
  askAction: (formData: FormData) => Promise<void>;
  isEmpty: boolean;
}) {
  const c = useDict().chat;
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isSending, startTransition] = useTransition();

  function submit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isSending) return;
    setError(false);
    setPending(trimmed);
    formRef.current?.reset();

    const formData = new FormData();
    formData.set('question', trimmed);
    startTransition(async () => {
      try {
        await askAction(formData);
        // Success: the revalidated server render (children) now holds the real
        // Q&A, so retire the optimistic tail in this same commit.
        setPending(null);
      } catch {
        // Restore the question so a retry is one keystroke away, show the notice.
        setPending(null);
        setError(true);
        if (inputRef.current) {
          inputRef.current.value = trimmed;
          inputRef.current.focus();
        }
      }
    });
  }

  return (
    <>
      <div className="chat-scroll">
        {/* Empty-state only until the very first question is on its way. */}
        {isEmpty && pending === null && !error ? emptyState : null}

        {/* Server-rendered history (bubbles, traces, feedback forms). */}
        {children}

        {/* Optimistic tail — only while a question is in flight. */}
        {pending !== null ? (
          <>
            <div className="bubble bubble--user" aria-hidden={false}>
              {pending}
            </div>
            <div
              className="bubble bubble--assistant bubble--thinking"
              role="status"
              aria-live="polite"
              aria-label={c.thinkingAria}
            >
              <span className="thinking">
                <span className="thinking-label">{c.thinking}</span>
                <span className="thinking-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </div>
          </>
        ) : null}

        {error ? (
          <div className="bubble bubble--error" role="alert">
            {c.sendError}
          </div>
        ) : null}
      </div>

      <div className="chat-input">
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get('question');
            submit(typeof value === 'string' ? value : '');
          }}
        >
          <input
            ref={inputRef}
            name="question"
            placeholder={c.questionPlaceholder}
            aria-label={c.questionAria}
            autoComplete="off"
            required
            disabled={isSending}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={isSending}
            aria-busy={isSending}
          >
            {isSending ? (
              <>
                <span className="btn-spinner" aria-hidden />
                {c.sending}
              </>
            ) : (
              c.ask
            )}
          </button>
        </form>
      </div>
    </>
  );
}
