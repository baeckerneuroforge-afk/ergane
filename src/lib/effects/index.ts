// Effect provider selection — mirror of src/lib/ai/index.ts:
//   RESEND_API_KEY set      → real Resend adapter (+ EFFECTS_EMAIL_FROM)
//   key missing, dev/test   → deterministic fake (records sends, no network)
//   key missing, production → throw. Production must never pretend to send.
import { FakeEmailProvider } from './fake';
import { ResendEmailProvider } from './resend';
import type { EmailProvider } from './types';

// One shared fake so tests/demos can assert on what "left" the system.
const fakeEmail = new FakeEmailProvider();

/** Test/demo handle to the shared fake (records + failNext + reset). */
export function getFakeEmailProvider(): FakeEmailProvider {
  return fakeEmail;
}

export function getEmailProvider(): EmailProvider {
  const key = process.env.RESEND_API_KEY;
  if (key) return new ResendEmailProvider(key, process.env.EFFECTS_EMAIL_FROM ?? '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getEmailProvider: RESEND_API_KEY is not set. Refusing to fall back to the fake provider in production.',
    );
  }
  return fakeEmail;
}

export { formatEur, renderBusinessPdf, renderSimplePdf } from './pdf';
export type { BusinessPdfInput, BusinessPdfPosition, PdfLocale, PdfSender } from './pdf';
export type { EmailProvider, EmailResult, OutgoingEmail, EmailAttachment } from './types';
