// Effect provider abstraction — real-world side effects behind an interface,
// exactly like the AI providers (src/lib/ai/): the skill catalog codes against
// the interface, the factory decides fake vs. real from the environment.
//
// Effects run ONLY inside acting skill steps — i.e. strictly AFTER the
// guardrail/approval gate of the engine. Nothing here weakens that: an effect
// provider has no way to run without an approved (or ungated) acting step.

export interface EmailAttachment {
  filename: string;
  /** Raw bytes (e.g. a rendered PDF). */
  content: Uint8Array;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  attachment?: EmailAttachment;
}

export interface EmailResult {
  /** Provider message id (fake: deterministic). */
  id: string;
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<EmailResult>;
}
