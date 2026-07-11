// Non-blocking notice when chat/embeddings use deterministic fakes (no live keys).
import type { Dictionary } from '@/lib/i18n';

export function FakeAiBanner({ dict }: { dict: Dictionary['fakeAiBanner'] }) {
  return (
    <div
      role="status"
      className="card"
      style={{
        marginBottom: '0.75rem',
        padding: '0.65rem 1rem',
        borderColor: 'var(--amber)',
        background: 'var(--amber-bg, #fff8e6)',
        fontSize: '0.9rem',
      }}
    >
      <strong>{dict.title}</strong> {dict.body}
    </div>
  );
}
