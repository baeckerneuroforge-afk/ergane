// Svix webhook-signature verification (Clerk delivers webhooks via Svix).
// Pure, dependency-free, testable — the sibling of src/lib/slack/verify.ts.
//
// Svix signs `${svix-id}.${svix-timestamp}.${raw body}` with HMAC-SHA256; the
// key is the base64 part of the endpoint secret ("whsec_<base64>"). The
// svix-signature header carries one or more space-separated "v1,<base64>"
// entries (key rotation) — the request is valid if ANY of them matches.
// Timestamp window ±5 minutes against replays.
//
// Fail-closed: missing secret/headers, malformed timestamp, unknown version,
// wrong length — everything verifies as FALSE.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5;

/** Compute the expected v1 signature (exported so tests/demo can BUILD valid
 * signed requests with a known secret). */
export function computeSvixSignature(
  secret: string,
  svixId: string,
  timestamp: string | number,
  rawBody: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${timestamp}.${rawBody}`;
  return createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
}

export interface VerifySvixSignatureInput {
  /** The endpoint secret, "whsec_<base64>". */
  secret: string;
  rawBody: string;
  idHeader: string | null | undefined; // svix-id
  timestampHeader: string | null | undefined; // svix-timestamp
  signatureHeader: string | null | undefined; // svix-signature ("v1,<b64> …")
  nowSeconds?: number;
}

export function verifySvixSignature(input: VerifySvixSignatureInput): boolean {
  const { secret, rawBody, idHeader, timestampHeader, signatureHeader } = input;
  if (!secret || !idHeader || !timestampHeader || !signatureHeader) return false;

  if (!/^\d+$/.test(timestampHeader)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestampHeader)) > SVIX_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(
    computeSvixSignature(secret, idHeader, timestampHeader, rawBody),
  );

  // "v1,<sig> v1,<sig2>" — valid if any v1 entry matches, constant-time each.
  for (const entry of signatureHeader.split(' ')) {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) continue;
    const received = Buffer.from(signature);
    if (received.length === expected.length && timingSafeEqual(expected, received)) {
      return true;
    }
  }
  return false;
}
