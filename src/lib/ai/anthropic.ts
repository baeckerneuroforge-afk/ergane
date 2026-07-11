// Anthropic (Claude) chat adapter — the default real ChatProvider.
//
// Deliberately thin: everything RAG-specific (grounding prompt, sources,
// honesty rule) lives in lib/rag, so moving to Claude on AWS Bedrock EU later
// is one new adapter (e.g. on top of @anthropic-ai/bedrock-sdk) with the same
// ChatProvider interface, selected in ./index.ts.
import Anthropic from '@anthropic-ai/sdk';
import { OUTBOUND_LLM_TIMEOUT_MS } from '../http-timeout';
import type { ChatCompletionRequest, ChatProvider } from './types';

const DEFAULT_MODEL = 'claude-opus-4-8';

export class AnthropicChatProvider implements ChatProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL) {
    if (!apiKey) throw new Error('AnthropicChatProvider: ANTHROPIC_API_KEY is required.');
    // Finite client timeout (SDK default is 10 minutes). Prevents a hung
    // Messages call from running until the platform kills the function.
    this.client = new Anthropic({ apiKey, timeout: OUTBOUND_LLM_TIMEOUT_MS });
    this.model = model;
  }

  async complete(req: ChatCompletionRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('Anthropic declined to answer this request (stop_reason: refusal).');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      throw new Error(
        `Anthropic returned no text (stop_reason: ${response.stop_reason ?? 'unknown'}).`,
      );
    }
    return text;
  }
}
