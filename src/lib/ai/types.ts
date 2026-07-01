// Provider abstraction for LLM + embeddings.
//
// Everything RAG-related talks to these two interfaces — NEVER to a vendor SDK
// directly. Swapping the vendor (the target is Claude via AWS Bedrock EU) means
// writing one new adapter and changing the factory in ./index.ts; no route,
// server action, or lib/rag code changes.

/**
 * Dimensionality of the `chunks.embedding vector(1024)` column. Every
 * EmbeddingProvider MUST produce vectors of exactly this size (the fake test
 * provider included). Changing the embedding model to a different size requires
 * a new DB migration — that is why this is a constant, not config.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Retrieval-tuned embedding models encode the corpus and the question
 * differently ("document" vs "query"); providers that don't distinguish may
 * ignore this.
 */
export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingProvider {
  readonly name: string;
  /** Must equal EMBEDDING_DIMENSIONS — asserted by the RAG layer. */
  readonly dimensions: number;
  /**
   * Cosine-similarity floor below which a retrieved chunk does NOT count as
   * relevant (→ the chat answers "no verified knowledge" instead of guessing).
   * Similarity distributions differ per embedding model, so the threshold
   * belongs to the provider, not to the RAG layer.
   */
  readonly relevanceThreshold: number;
  /** Embed `texts` in order; returns one vector per input text. */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}

export interface ChatProvider {
  readonly name: string;
  /** Returns the assistant's text answer (non-streaming). */
  complete(req: ChatCompletionRequest): Promise<string>;
}
