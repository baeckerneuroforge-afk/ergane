// Linear webhook signature verification — first gate of the public webhook.
// Linear signs the raw body with HMAC-SHA256; header is Linear-Signature (hex).
// Fail-closed: missing secret/header, wrong length, replay outside window.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Replay window for Linear-Delivery / webhook timestamps (5 minutes). */
export const LINEAR_TIMESTAMP_TOLERANCE_MS = 60 * 5 * 1000;

export function computeLinearSignature(signingSecret: string, rawBody: string): string {
  return createHmac('sha256', signingSecret).update(rawBody, 'utf8').digest('hex');
}

export interface VerifyLinearSignatureInput {
  signingSecret: string;
  rawBody: string;
  /** Value of Linear-Signature (hex HMAC). */
  signatureHeader: string | null | undefined;
  /**
   * Optional webhookTimestamp from JSON body (ms). When present, enforce
   * replay window. Injectable clock for tests.
   */
  webhookTimestampMs?: number | null;
  nowMs?: number;
}

export function verifyLinearSignature(input: VerifyLinearSignatureInput): boolean {
  const { signingSecret, rawBody, signatureHeader } = input;
  if (!signingSecret || !signatureHeader) return false;
  if (!/^[0-9a-fA-F]+$/.test(signatureHeader)) return false;

  if (input.webhookTimestampMs != null && Number.isFinite(input.webhookTimestampMs)) {
    const now = input.nowMs ?? Date.now();
    if (Math.abs(now - input.webhookTimestampMs) > LINEAR_TIMESTAMP_TOLERANCE_MS) {
      return false;
    }
  }

  const expected = Buffer.from(computeLinearSignature(signingSecret, rawBody), 'utf8');
  const received = Buffer.from(signatureHeader, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
