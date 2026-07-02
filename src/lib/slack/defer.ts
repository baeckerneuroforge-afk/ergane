// deferWork() — run work AFTER the HTTP response ("ack-then-work").
//
// Slack requires a 200 within 3 seconds, otherwise it redelivers the request
// (up to 3×). The handlers therefore return 200 as soon as the security gates
// (signature → team→org → user→role) and the idempotency claim have passed,
// and hand the actual work (answerQuestion / startRun / approve …) to
// deferWork(). The deferred task delivers its result via the Slack poster.
//
// Node default (dev / self-hosted): fire-and-forget on the already-running
// promise — the Response is returned immediately, the event loop keeps the
// task alive. Errors NEVER become unhandled rejections: they are logged and
// reported to the user in Slack via the task's onFailure callback (whose own
// failure is also only logged).
//
// PLATFORM HOOK (serverless): on runtimes that freeze the instance right after
// the response (Vercel Functions/Lambda), a fire-and-forget promise can be cut
// off. Wire the platform's keep-alive through setDeferKeepAlive() ONCE at
// startup, e.g. with Next.js 15:
//
//     import { after } from 'next/server';
//     setDeferKeepAlive((pending) => after(() => pending));
//
// (or `waitUntil` from @vercel/functions). The default keep-alive is a no-op —
// correct wherever the process simply keeps running.
//
// Tests/demo: drainDeferredWork() awaits everything currently deferred, making
// the "200 first, work afterwards" order observable and deterministic.

type KeepAlive = (pending: Promise<void>) => void;

let keepAlive: KeepAlive = () => {};

/** All not-yet-finished deferred tasks (for drainDeferredWork). */
const pending = new Set<Promise<void>>();

/** Install the platform keep-alive (e.g. Next after() / Vercel waitUntil).
 * Pass null to restore the no-op default. */
export function setDeferKeepAlive(next: KeepAlive | null): void {
  keepAlive = next ?? (() => {});
}

export interface DeferWorkOptions {
  /** Called when the task throws — use it to tell the Slack user something
   * went wrong. Its own errors are swallowed (logged), never rethrown. */
  onFailure?: (err: unknown) => Promise<void>;
  /** Label for error logs, e.g. 'events:answer'. */
  label?: string;
}

export function deferWork(task: () => Promise<void>, opts: DeferWorkOptions = {}): void {
  const run = (async () => {
    try {
      await task();
    } catch (err) {
      console.error(`[slack] deferred work${opts.label ? ` (${opts.label})` : ''} failed:`, err);
      if (opts.onFailure) {
        try {
          await opts.onFailure(err);
        } catch (notifyErr) {
          console.error('[slack] failure notification also failed:', notifyErr);
        }
      }
    }
  })();

  pending.add(run);
  void run.finally(() => pending.delete(run));
  keepAlive(run);
}

/** Await every currently deferred task (including ones a task defers while we
 * wait). Used by tests and `pnpm demo:slack` — never by request handlers. */
export async function drainDeferredWork(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
