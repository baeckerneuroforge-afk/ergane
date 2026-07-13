// =============================================================================
// retrieveWithTrace — single SQL round-trip (package C)
// Structural check on the shipped module + semantic check via answer-trace
// suite (filteredCount disclosure). Here we prove the dual sequential
// countFilteredHits/searchVisible path is gone.
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('retrieveWithTrace SQL shape', () => {
  it('uses one combined query (searchVisibleWithTrace) not sequential dual scans', () => {
    const src = readFileSync(join(__dirname, '../src/lib/rag/retrieve.ts'), 'utf8');
    expect(src).toMatch(/function searchVisibleWithTrace/);
    expect(src).toMatch(/WITH visible_top AS/);
    expect(src).toMatch(/nearest AS/);
    expect(src).toMatch(/filtered AS/);
    // Old separate helper must not remain as a second sequential call path
    expect(src).not.toMatch(/function countFilteredHits/);
    // retrieveWithTrace should call the combined helper once
    const body = src.slice(src.indexOf('export async function retrieveWithTrace'));
    expect(body).toMatch(/searchVisibleWithTrace/);
    expect(body).not.toMatch(/searchVisible\(/);
    // Only one $queryRaw invocation inside searchVisibleWithTrace (the combined stmt)
    const combined = src.slice(
      src.indexOf('function searchVisibleWithTrace'),
      src.indexOf('function toRetrievedChunks'),
    );
    const raws = combined.match(/\$queryRaw`/g) ?? [];
    expect(raws.length).toBe(1);
  });
});
