// Standalone, calm full-page canvas for the live demos (no dashboard sidebar).
// Auth still applies: /demo/* is not a public route, so middleware requires a
// signed-in user with an active org before this renders.
export const dynamic = 'force-dynamic';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="demo-canvas">{children}</div>;
}
