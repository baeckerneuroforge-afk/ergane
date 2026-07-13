// GitHub webhook signature: X-Hub-Signature-256 = sha256=<hmac-hex>
import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeGitHubSignature(secret: string, rawBody: string): string {
  const hex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

export function verifyGitHubSignature(input: {
  signingSecret: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
}): boolean {
  const { signingSecret, rawBody, signatureHeader } = input;
  if (!signingSecret || !signatureHeader) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = Buffer.from(computeGitHubSignature(signingSecret, rawBody), 'utf8');
  const received = Buffer.from(signatureHeader, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
