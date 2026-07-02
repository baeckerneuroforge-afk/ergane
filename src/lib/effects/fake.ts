// Deterministic fake email provider — no network, no keys.
//
// Used by the test suite and demos (CI must never send a real mail). It
// RECORDS every send so tests can assert "the mail left exactly once, only
// after the approval", and can be armed to fail once (failNext) to prove the
// engine's failure path (step failed → run failed → audit).
import type { EmailProvider, EmailResult, OutgoingEmail } from './types';

export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: OutgoingEmail[] = [];
  private failNextReason: string | null = null;

  async send(email: OutgoingEmail): Promise<EmailResult> {
    if (this.failNextReason) {
      const reason = this.failNextReason;
      this.failNextReason = null;
      throw new Error(`FakeEmailProvider: ${reason}`);
    }
    this.sent.push(email);
    return { id: `fake-mail-${this.sent.length}`, provider: this.name };
  }

  /** Arm the provider to reject the NEXT send (tests: effect-failure path). */
  failNext(reason = 'simulated delivery failure'): void {
    this.failNextReason = reason;
  }

  reset(): void {
    this.sent.length = 0;
    this.failNextReason = null;
  }
}
