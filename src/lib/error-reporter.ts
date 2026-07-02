// Error reporting to an external sink (Phase 16) — vendor-neutral.
//
// initErrorReporterFromEnv() wires log.ts's setErrorReporter() to POST every
// logError() to ERROR_WEBHOOK_URL as one JSON object (fire-and-forget, fully
// masked via maskSecrets, never throws into the caller). Works with any
// JSON-accepting sink: a Slack/Discord webhook, an alerting relay, or a
// Sentry-forwarding function.
//
// For a full Sentry SDK integration replace this wiring in
// src/instrumentation.ts with:
//   Sentry.init({ dsn: process.env.SENTRY_DSN });
//   setErrorReporter((err, ctx) => Sentry.captureException(err, { extra: ctx }));
// — the log.ts contract stays identical.
import { maskSecrets, setErrorReporter } from './log';

type FetchLike = (url: string, init: RequestInit) => Promise<unknown>;

/** Injectable transport (tests); defaults to global fetch. */
let transport: FetchLike = (url, init) => fetch(url, init);

export function setErrorReporterTransport(next: FetchLike | null): void {
  transport = next ?? ((url, init) => fetch(url, init));
}

export function initErrorReporterFromEnv(): boolean {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return false;

  setErrorReporter((err, context) => {
    const payload = {
      source: 'ergane',
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      context: maskSecrets(context),
      time: new Date().toISOString(),
    };
    // Fire-and-forget: a broken sink must never break the app path — log.ts
    // already swallows reporter errors, this catch handles the async leg.
    void transport(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  });
  return true;
}
