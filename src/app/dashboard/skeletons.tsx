// Skeleton building blocks for the per-route loading.tsx states. Pure display,
// server-renderable. Widths vary per row so the shimmer doesn't look like a
// solid block; all motion lives in CSS (globals.css, .skeleton) and respects
// prefers-reduced-motion.

export function SkeletonLine({ width = '100%' }: { width?: string }) {
  return <span className="skeleton skeleton--line" style={{ width }} aria-hidden />;
}

export function SkeletonIntro() {
  return (
    <p className="page-intro" aria-hidden>
      <SkeletonLine width="60%" />
    </p>
  );
}

export function SkeletonKpiGrid() {
  return (
    <div className="kpi-grid" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div className="card" key={i}>
          <div className="kpi-label">
            <SkeletonLine width="70%" />
          </div>
          <div className="kpi-value">
            <SkeletonLine width="2.2rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

const ROW_WIDTHS = ['82%', '64%', '74%', '58%', '78%', '66%', '71%', '61%'];

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <section className="card card--table" aria-hidden>
      <table className="table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <SkeletonLine width={ROW_WIDTHS[(r + c * 3) % ROW_WIDTHS.length]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <section className="card" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} style={{ marginBottom: '0.55rem' }}>
          <SkeletonLine width={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
        </div>
      ))}
    </section>
  );
}

export function SkeletonChat() {
  return (
    <div className="chat-page" aria-hidden>
      <SkeletonIntro />
      <div className="chat-scroll">
        <div className="bubble bubble--user skeleton-bubble">
          <SkeletonLine width="55%" />
        </div>
        <div className="bubble bubble--assistant skeleton-bubble">
          <SkeletonLine width="92%" />
          <SkeletonLine width="80%" />
          <SkeletonLine width="45%" />
        </div>
        <div className="bubble bubble--user skeleton-bubble">
          <SkeletonLine width="40%" />
        </div>
        <div className="bubble bubble--assistant skeleton-bubble">
          <SkeletonLine width="88%" />
          <SkeletonLine width="62%" />
        </div>
      </div>
      <div className="chat-input">
        <div className="skeleton skeleton--input" />
      </div>
    </div>
  );
}

/** Full-page fallback used while a dashboard route's data is loading. */
export function SkeletonPage({ kind }: { kind: 'overview' | 'table' | 'cards' }) {
  if (kind === 'overview') {
    return (
      <>
        <SkeletonKpiGrid />
        <SkeletonTable rows={5} cols={3} />
      </>
    );
  }
  if (kind === 'cards') {
    return (
      <>
        <SkeletonIntro />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </>
    );
  }
  return (
    <>
      <SkeletonIntro />
      <SkeletonTable />
    </>
  );
}
