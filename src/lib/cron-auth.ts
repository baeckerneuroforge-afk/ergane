// Constant-time check of the Vercel Cron `Authorization: Bearer <CRON_SECRET>`
// header (Audit-Fix F7). Vercel Cron attaches this header automatically when
// CRON_SECRET is set in the project; the cron routes are otherwise public
// (middleware exempts /api/cron(.*)), so this is their whole auth.
//
// Why timingSafeEqual and not `header !== 'Bearer ' + secret`: every other secret
// comparison in the codebase (Slack/Svix HMAC, OAuth state) is constant-time; a
// plain string `!==` short-circuits on the first differing byte and leaks a
// (tiny, network-noisy) timing signal about the secret. This closes that gap for
// consistency. Fail-closed: any missing/short/mismatched header returns false.
import { timingSafeEqual } from 'node:crypto';

/**
 * True iff `authorizationHeader` equals `Bearer <expectedSecret>`, compared in
 * constant time. `expectedSecret` must be non-empty (callers already 503 when
 * CRON_SECRET is unset, so this is only reached with a real secret).
 */
export function cronSecretMatches(
  authorizationHeader: string | null | undefined,
  expectedSecret: string,
): boolean {
  if (!authorizationHeader || !expectedSecret) return false;
  const expected = Buffer.from(`Bearer ${expectedSecret}`);
  const received = Buffer.from(authorizationHeader);
  // timingSafeEqual requires equal lengths; comparing lengths first is fine —
  // the length of the fixed "Bearer <secret>" string is not itself a secret.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
