// Deterministic fake providers — no network, no API keys.
//
// Used by the test suite (CI must never make a real API call) and by
// `pnpm demo:rag` when no keys are set. The fake embedder is not just random:
// it is a hashed bag-of-words model, so texts that share vocabulary really do
// get a higher cosine similarity. That makes retrieval order, isolation tests,
// and the "no relevant knowledge" threshold meaningful without a real model.
import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMENSIONS,
  type ChatCompletionRequest,
  type ChatProvider,
  type EmbeddingInputType,
  type EmbeddingProvider,
} from './types';

// Tiny stopword list so that two texts sharing only filler words ("und", "the")
// do not look related to the fake model.
const STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'und',
  'oder', 'ist', 'sind', 'war', 'hat', 'haben', 'mit', 'von', 'für', 'auf',
  'aus', 'bei', 'wie', 'was', 'wer', 'wir', 'sie', 'ich', 'nicht', 'auch',
  'the', 'and', 'for', 'are', 'with', 'that', 'this', 'has', 'have', 'how',
  'what', 'who', 'you', 'our', 'not',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  // Bag-of-words cosine of a short question vs. a longer chunk is small even
  // when clearly related (few shared tokens against the chunk's norm), so the
  // fake floor sits low. Content-word overlap is required regardless.
  readonly relevanceThreshold = 0.05;

  async embed(texts: string[], _inputType: EmbeddingInputType): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array<number>(this.dimensions).fill(0);
      for (const token of tokenize(text)) {
        // First 4 hash bytes → a stable bucket per token.
        const bucket =
          createHash('sha256').update(token).digest().readUInt32BE(0) % this.dimensions;
        vec[bucket] += 1;
      }
      // L2-normalize so cosine similarity behaves; an all-zero text gets a
      // fixed unit vector instead of NaN.
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      if (norm === 0) {
        vec[0] = 1;
        return vec;
      }
      return vec.map((v) => v / norm);
    });
  }
}

/**
 * Deterministic "LLM": answers strictly from the supplied context block, or
 * echoes that it has none. Good enough to exercise the full RAG path (prompting,
 * persistence, audit, sources) without a key.
 */
export class FakeChatProvider implements ChatProvider {
  readonly name = 'fake';

  async complete(req: ChatCompletionRequest): Promise<string> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const firstContextLine =
      lastUser?.content
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('[')) ?? null;

    if (!firstContextLine) {
      return 'Dazu habe ich kein geprüftes Wissen in der Wissensbasis.';
    }
    // Echo the passage WITHOUT its [title] prefix: like the real model, the
    // fake emits only answer text — the canonical "Quellen: …" line is appended
    // by the RAG layer (answerQuestion), never by a chat provider.
    return `Laut der Wissensbasis: ${firstContextLine.replace(/^\[[^\]]*\]\s*/, '')}`;
  }
}
