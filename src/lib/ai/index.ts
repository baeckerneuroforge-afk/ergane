// Provider selection — the ONLY place that decides which vendor is behind the
// EmbeddingProvider / ChatProvider interfaces.
//
// Selection rule:
//   key set          → real provider (Voyage embeddings / Anthropic chat)
//   key missing, dev → deterministic fake providers (tests, `pnpm demo:rag`)
//   key missing, prod→ throw. Production must never silently answer from fakes.
//
// Later migration to Claude via AWS Bedrock (EU): add a BedrockChatProvider
// adapter and switch it in here (e.g. keyed on AI_CHAT_PROVIDER=bedrock). No
// caller changes — see README "Provider abstraction".
import { AnthropicChatProvider } from './anthropic';
import { FakeChatProvider, FakeEmbeddingProvider } from './fake';
import type { ChatProvider, EmbeddingProvider } from './types';
import { VoyageEmbeddingProvider } from './voyage';

function requireFakeAllowed(kind: string, envKey: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${kind}: ${envKey} is not set. Refusing to fall back to the fake provider in production.`,
    );
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const key = process.env.VOYAGE_API_KEY;
  if (key) return new VoyageEmbeddingProvider(key);
  requireFakeAllowed('getEmbeddingProvider', 'VOYAGE_API_KEY');
  return new FakeEmbeddingProvider();
}

export function getChatProvider(): ChatProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return new AnthropicChatProvider(key);
  requireFakeAllowed('getChatProvider', 'ANTHROPIC_API_KEY');
  return new FakeChatProvider();
}

export * from './types';
