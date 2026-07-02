// Next.js instrumentation hook — runs ONCE per server instance at startup.
//
// Wires the platform keep-alive into deferWork() (src/lib/slack/defer.ts):
// on serverless runtimes (Vercel Functions/Lambda) the instance can freeze
// right after the HTTP response, cutting off fire-and-forget promises —
// next/server's after() keeps the instance alive until the deferred work
// settles. after() must be called during a request; deferWork() only runs
// inside route handlers, so that holds. Outside a request scope (scripts,
// tests — which do not load instrumentation anyway) the call would throw, so
// it is guarded and falls back to plain fire-and-forget.
export async function register(): Promise<void> {
  const [{ after }, { setDeferKeepAlive }] = await Promise.all([
    import('next/server'),
    import('./lib/slack/defer'),
  ]);
  setDeferKeepAlive((pending) => {
    try {
      after(pending);
    } catch {
      // Not in a request scope (e.g. warmup) — plain fire-and-forget is fine.
    }
  });

  // Error reporting (Phase 16): vendor-neutral webhook sink — active as soon
  // as ERROR_WEBHOOK_URL is set; without it, logError() stays log-only.
  // For a full Sentry SDK integration replace this with Sentry.init + a
  // setErrorReporter wiring (see src/lib/error-reporter.ts header).
  const { initErrorReporterFromEnv } = await import('./lib/error-reporter');
  initErrorReporterFromEnv();
}
