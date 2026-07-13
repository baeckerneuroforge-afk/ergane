// Drive push / channel notifications: HMAC over raw body with DRIVE_WEBHOOK_SECRET.
// (Google's channel token is compared as an alternative shared secret.)
import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeDriveSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyDriveSignature(input: {
  signingSecret: string;
  rawBody: string;
  /** Header X-Helix-Drive-Signature or channel token match. */
  signatureHeader: string | null | undefined;
  channelTokenHeader?: string | null;
}): boolean {
  const { signingSecret, rawBody, signatureHeader, channelTokenHeader } = input;
  if (!signingSecret) return false;

  // Channel token path (Google Drive watch): constant-time string compare.
  if (channelTokenHeader) {
    const expected = Buffer.from(signingSecret, 'utf8');
    const received = Buffer.from(channelTokenHeader, 'utf8');
    if (expected.length === received.length && timingSafeEqual(expected, received)) {
      return true;
    }
  }

  if (!signatureHeader || !/^[0-9a-fA-F]+$/.test(signatureHeader)) return false;
  const expected = Buffer.from(computeDriveSignature(signingSecret, rawBody), 'utf8');
  const received = Buffer.from(signatureHeader, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
