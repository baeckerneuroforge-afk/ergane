// OCR for scanned PDFs (Phase 17) — provider abstraction, same pattern as the
// AI/effects providers: extract.ts codes against the interface, the factory
// decides from the environment.
//
// Fail-closed stays the rule: WITHOUT a configured provider, scanned PDFs are
// rejected exactly as before (clear German error, nothing ingested). There is
// deliberately NO fake fallback in the factory — dev/tests inject the fake
// explicitly, so a missing key can never silently "pretend-OCR" a document
// into the knowledge base.
//
// Real adapter: Claude via the EXISTING Anthropic dependency — the messages
// API accepts PDFs natively (base64 document block, vision reads scanned
// pages). No new vendor, no rasterizer.
//
// Cost guard: OCR_MAX_PAGES (default 30) — larger scans are rejected with a
// clear message before any API call.
import Anthropic from '@anthropic-ai/sdk';

export const OCR_MAX_PAGES = 30;

export interface OcrProvider {
  readonly name: string;
  /** Full text of the (scanned) PDF, page order preserved. */
  extractPdfText(data: Uint8Array): Promise<string>;
}

/** Deterministic fake for tests/demo — returns the configured text. */
export class FakeOcrProvider implements OcrProvider {
  readonly name = 'fake';
  constructor(private readonly text: string) {}
  async extractPdfText(): Promise<string> {
    return this.text;
  }
}

const OCR_PROMPT =
  'Transcribe ALL text contained in this document, in reading order, as plain text. ' +
  'Preserve paragraph breaks with blank lines. Output ONLY the transcription — ' +
  'no commentary, no summary, no markdown fences.';

export class AnthropicOcrProvider implements OcrProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8') {
    if (!apiKey) throw new Error('AnthropicOcrProvider: ANTHROPIC_API_KEY is required.');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extractPdfText(data: Uint8Array): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 32000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: Buffer.from(data).toString('base64'),
              },
            },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
}

/** null = no OCR configured ⇒ extract.ts keeps rejecting scanned PDFs. */
export function getOcrProvider(): OcrProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicOcrProvider(key) : null;
}
