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

// Test-only override slot. Tests that must exercise a skill's LLM step without a
// network call (CI never calls a real API) can install a deterministic
// ChatProvider here instead of depending on the ANTHROPIC_API_KEY env. Kept
// tiny and clearly named; it is ignored entirely in production paths because
// tests are the only caller that sets it. Always reset it in afterAll/afterEach.
let chatProviderOverride: ChatProvider | null = null;

/** TEST ONLY: force getChatProvider() to return `provider` (or clear with null). */
export function __setChatProviderForTests(provider: ChatProvider | null): void {
  chatProviderOverride = provider;
}

export function getChatProvider(): ChatProvider {
  if (chatProviderOverride) return chatProviderOverride;
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return new AnthropicChatProvider(key);
  requireFakeAllowed('getChatProvider', 'ANTHROPIC_API_KEY');
  return new FakeChatProvider();
}

/**
 * Pure env check: true when chat and/or embeddings would use the deterministic
 * fake adapters (keys missing). Used by UI banners — never calls vendors.
 * In production both keys are required; this returns false if both are set.
 *
 * Accepts ProcessEnv or a partial key bag (tests). Default reads process.env.
 */
export function isUsingFakeAiProviders(
  env?: NodeJS.ProcessEnv | { ANTHROPIC_API_KEY?: string; VOYAGE_API_KEY?: string },
): boolean {
  const source = env ?? process.env;
  const chatFake = !source.ANTHROPIC_API_KEY?.trim();
  const embedFake = !source.VOYAGE_API_KEY?.trim();
  return chatFake || embedFake;
}

export * from './types';
