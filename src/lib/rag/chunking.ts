// Deterministic text chunking for ingestion.
//
// Paragraph-aware sliding window: paragraphs are packed into chunks of at most
// `maxChars`; a paragraph that is itself too long is split hard. Consecutive
// chunks share `overlapChars` of trailing context so a fact sitting on a chunk
// boundary is still retrievable.

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 200;

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (maxChars <= 0) throw new Error('chunkText: maxChars must be positive.');
  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('chunkText: overlapChars must be in [0, maxChars).');
  }

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // Split into paragraphs, hard-splitting any single paragraph over the limit.
  const pieces: string[] = [];
  for (const para of normalized.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChars) {
      pieces.push(p);
    } else {
      // Hard-split fallback for a single oversize paragraph. Additive
      // refinement (0005): prefer breaking at a whitespace near the limit so
      // words survive intact; only a pathological 600+-char "word" is cut.
      let start = 0;
      while (start < p.length) {
        let end = Math.min(start + maxChars, p.length);
        if (end < p.length) {
          const ws = p.lastIndexOf(' ', end);
          if (ws > start + maxChars / 2) end = ws;
        }
        pieces.push(p.slice(start, end).trim());
        if (end >= p.length) break;
        start = Math.max(end - overlapChars, start + 1);
      }
    }
  }

  // Pack pieces into chunks; start each new chunk with the tail of the previous
  // one as overlap.
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxChars) {
      chunks.push(current);
      const tail = current.slice(-overlapChars).trimStart();
      current = tail ? `${tail}\n\n${piece}` : piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
