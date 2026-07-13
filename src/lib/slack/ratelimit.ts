// In-memory fixed-window rate limiter (shared backstop).
//
// Used for:
//   • PUBLIC Slack/webhook endpoints (per client IP) — protect HMAC + DB
//   • AUTHENTICATED expensive dashboard paths (chat, skill-start, upload) —
//     burst protection on top of daily soft limits (src/lib/limits.ts)
//
// Per-process / per serverless instance. For hard multi-instance guarantees
// put a platform limiter (e.g. Vercel WAF) in front; this is the in-app backstop.
//
// Fixed-window counter per key: allow at most LIMIT requests per WINDOW. Old
// windows are pruned opportunistically so the map cannot grow unbounded.

const WINDOW_MS = 60_000;
/** Default for public Slack/webhook endpoints (per IP). */
export const RATE_LIMIT_PER_MINUTE = 60;

/**
 * Burst cap for authenticated expensive actions (per org+user+kind).
 * Daily soft limits still apply separately; this stops rapid hammering.
 */
export const AUTH_BURST_LIMIT_PER_MINUTE = 20;

export type AuthBurstKind = 'chat' | 'skill-start' | 'upload';

export const AUTH_BURST_ERROR =
  'Too many requests. Please wait a minute and try again.';

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

/**
 * Key for authenticated burst limits — scoped to org AND user so one tenant
 * member cannot burn another's budget, and kinds stay isolated.
 */
export function authBurstKey(kind: AuthBurstKind, orgId: string, userId: string): string {
  return `auth:${kind}:${orgId}:${userId}`;
}

/**
 * Fail-closed gate for chat / skill-start / upload actions.
 * Throws AUTH_BURST_ERROR when the per-minute burst cap is exceeded.
 */
export function assertAuthBurstLimit(
  kind: AuthBurstKind,
  orgId: string,
  userId: string,
  now: number = Date.now(),
  limit: number = AUTH_BURST_LIMIT_PER_MINUTE,
): void {
  const key = authBurstKey(kind, orgId, userId);
  if (!checkRateLimit(key, now, limit)) {
    throw new Error(AUTH_BURST_ERROR);
  }
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
