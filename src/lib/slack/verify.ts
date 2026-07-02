// Slack request-signature verification — the FIRST gate of the external Slack
// entry point. Pure, dependency-free, fully testable.
//
// Slack signs every request it sends: signature = HMAC-SHA256 over
// `v0:<timestamp>:<raw body>` with the app's signing secret, sent as
// X-Slack-Signature ("v0=<hex>") next to X-Slack-Request-Timestamp.
// We recompute and compare in constant time; requests whose timestamp is
// outside a ±5-minute window are rejected regardless (replay protection).
//
// Fail-closed: missing secret, missing headers, malformed timestamp, wrong
// length — every anomaly verifies as FALSE, never as "probably fine".
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Replay window: Slack recommends rejecting requests older than 5 minutes. */
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5;

export const SLACK_SIGNATURE_VERSION = 'v0';

/** Compute the expected signature for a request — exported so tests and the
 * demo script can BUILD valid signed requests with a known secret. */
export function computeSlackSignature(
  signingSecret: string,
  timestamp: string | number,
  rawBody: string,
): string {
  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const hex = createHmac('sha256', signingSecret).update(base, 'utf8').digest('hex');
  return `${SLACK_SIGNATURE_VERSION}=${hex}`;
}

export interface VerifySlackSignatureInput {
  signingSecret: string;
  /** The raw, unparsed request body — the signature covers these exact bytes. */
  rawBody: string;
  /** Value of X-Slack-Request-Timestamp (seconds since epoch). */
  timestampHeader: string | null | undefined;
  /** Value of X-Slack-Signature ("v0=<hex>"). */
  signatureHeader: string | null | undefined;
  /** Injectable clock (seconds since epoch) for deterministic tests. */
  nowSeconds?: number;
}

export function verifySlackSignature(input: VerifySlackSignatureInput): boolean {
  const { signingSecret, rawBody, timestampHeader, signatureHeader } = input;
  if (!signingSecret || !timestampHeader || !signatureHeader) return false;

  // Replay window: the timestamp must be a plain integer within ±5 minutes.
  if (!/^\d+$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SLACK_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(computeSlackSignature(signingSecret, timestampHeader, rawBody));
  const received = Buffer.from(signatureHeader);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
