// In-memory rate limiter for the PUBLIC Slack/webhook endpoints.
//
// Purpose: protect the HMAC computation and DB lookups from flooding with
// garbage requests. This is per-process (fine for dev/self-host, one bucket
// per serverless instance) — for hard guarantees put a platform limiter
// (e.g. Vercel WAF rate rules) in front; this is the in-app backstop.
//
// Fixed-window counter per key (caller passes the client IP): allow at most
// LIMIT requests per WINDOW. Old windows are pruned opportunistically so the
// map cannot grow unbounded under an IP-spraying attack.

const WINDOW_MS = 60_000;
export const RATE_LIMIT_PER_MINUTE = 60;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

/** True = request allowed; false = over the limit (respond 429). */
export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = RATE_LIMIT_PER_MINUTE,
): boolean {
  // Opportunistic prune: drop stale buckets so the map stays small.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= WINDOW_MS) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Test helper: forget all counters. */
export function resetRateLimiter(): void {
  buckets.clear();
}

/** Client key for a request: first hop of x-forwarded-for, else 'unknown'. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? (fwd.split(',')[0] ?? '').trim() || 'unknown' : 'unknown';
}
