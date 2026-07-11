// Real email adapter: Resend (https://resend.com) via plain fetch.
// Selected by the factory when RESEND_API_KEY is set; EFFECTS_EMAIL_FROM is
// the verified sender address. Attachment bytes go base64-encoded, per API.
// Outbound calls use fetchWithTimeout so a hung Resend API cannot pin the fn.
import { fetchWithTimeout } from '../http-timeout';
import type { EmailProvider, EmailResult, OutgoingEmail } from './types';

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!from) {
      throw new Error('ResendEmailProvider: EFFECTS_EMAIL_FROM is required (verified sender).');
    }
  }

  async send(email: OutgoingEmail): Promise<EmailResult> {
    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.attachment
          ? {
              attachments: [
                {
                  filename: email.attachment.filename,
                  content: Buffer.from(email.attachment.content).toString('base64'),
                },
              ],
            }
          : {}),
      }),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok || !data.id) {
      throw new Error(`ResendEmailProvider: send failed (${res.status}): ${data.message ?? 'unknown'}`);
    }
    return { id: data.id, provider: this.name };
  }
}
