// Voyage AI embeddings adapter.
//
// Anthropic does not offer an embeddings endpoint; Voyage is Anthropic's
// recommended embeddings partner. Plain fetch — the API is a single POST and
// pulling in an SDK for it buys nothing.
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingInputType,
  type EmbeddingProvider,
} from './types';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// voyage-3.5 produces 1024-dimensional vectors by default — this must stay in
// sync with the vector(1024) column (see types.ts).
const DEFAULT_MODEL = 'voyage-3.5';

interface VoyageResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.VOYAGE_EMBEDDING_MODEL || DEFAULT_MODEL) {
    if (!apiKey) throw new Error('VoyageEmbeddingProvider: VOYAGE_API_KEY is required.');
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: inputType,
        output_dimension: this.dimensions,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Voyage embeddings failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as VoyageResponse;
    const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length) {
      throw new Error(
        `Voyage embeddings: expected ${texts.length} vectors, got ${vectors.length}.`,
      );
    }
    return vectors;
  }
}
