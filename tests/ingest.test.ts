// =============================================================================
// INGESTION FORMATS (Phase 5): extraction layer + paragraph-aware chunking.
//
// Extends — never replaces — the existing gates. Runs as `app_user` like the
// app; the owner connection only resets state. All embeddings use the
// deterministic FAKE provider — no network.
//
// What it proves:
//   1. Every supported format (.pdf/.docx/.md/.txt) extracts server-side and
//      lands as chunks with the correct org_id via the EXISTING
//      ingestDocument() pipeline, with format/page/word metadata on the row.
//   2. A scanned PDF without a text layer fails CLOSED: clear error, and no
//      document/chunk row is created (extraction happens before any write).
//   3. Oversize files and MIME/extension mismatches are rejected.
//   4. Chunking is paragraph-aware: chunks never cut inside a paragraph unless
//      a single paragraph exceeds the 1200-char hard limit.
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { ingestDocument } from '../src/lib/rag';
import { chunkText } from '../src/lib/rag/chunking';
import {
  ExtractionError,
  MAX_FILE_BYTES,
  extractText,
  type SourceFormat,
} from '../src/lib/ingest/extract';

const ORG = '77777777-7777-4777-8777-777777777777';
const TABLES = ['organizations', 'documents', 'chunks', 'audit_log'];
const FIXTURES = join(__dirname, '..', 'fixtures');

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const embedder = new FakeEmbeddingProvider();

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_ingest_test', name: 'Ingest Test Org' },
    });
  });
});

describe('extraction layer → existing ingestDocument pipeline', () => {
  const CASES: Array<{ file: string; mime: string; format: SourceFormat; mustContain: string }> = [
    { file: 'sample.pdf', mime: 'application/pdf', format: 'pdf', mustContain: 'Kuendigungsfrist' },
    {
      file: 'sample.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      format: 'docx',
      mustContain: 'Homeoffice',
    },
    { file: 'sample.md', mime: 'text/markdown', format: 'md', mustContain: 'Zugangskarte' },
    { file: 'sample.txt', mime: 'text/plain', format: 'txt', mustContain: 'Verpflegungspauschale' },
  ];

  for (const c of CASES) {
    it(`${c.file} extracts and lands as chunks with the correct org_id`, async () => {
      const { text, meta } = await extractText({
        filename: c.file,
        mimeType: c.mime,
        data: fixture(c.file),
      });
      expect(meta.format).toBe(c.format);
      expect(meta.wordCount).toBeGreaterThan(0);
      expect(text).toContain(c.mustContain);

      const { documentId, chunkCount } = await ingestDocument({
        orgId: ORG,
        actorId: 'test-ingest',
        title: c.file,
        source: 'upload',
        text,
        embedder,
        meta: { sourceFormat: meta.format, pageCount: meta.pageCount, wordCount: meta.wordCount },
      });
      expect(chunkCount).toBeGreaterThan(0);

      const [doc, chunks] = await withTenant(ORG, async (tx) => [
        await tx.document.findUniqueOrThrow({ where: { id: documentId } }),
        await tx.$queryRaw<Array<{ org_id: string; content: string }>>`
          SELECT "org_id", "content" FROM "chunks" WHERE "document_id" = ${documentId}::uuid`,
      ] as const);

      expect(doc.sourceFormat).toBe(c.format);
      expect(doc.wordCount).toBe(meta.wordCount);
      if (c.format === 'pdf') expect(doc.pageCount).toBe(1);
      else expect(doc.pageCount).toBeNull();

      expect(chunks).toHaveLength(chunkCount);
      for (const chunk of chunks) expect(chunk.org_id).toBe(ORG);
      expect(chunks.some((chunk) => chunk.content.includes(c.mustContain))).toBe(true);
    });
  }

  it('markdown cleanup keeps every word but drops decoration; code fences stay intact', async () => {
    const { text } = await extractText({
      filename: 'sample.md',
      mimeType: 'text/markdown',
      data: fixture('sample.md'),
    });
    // Heading markers stripped ('# Beispiel' inside the code fence stays —
    // fence content is deliberately verbatim).
    expect(text).not.toContain('# Onboarding-Leitfaden');
    expect(text).not.toContain('## Erster Arbeitstag');
    expect(text).toContain('Onboarding-Leitfaden');
    expect(text).not.toContain('**'); // bold markers stripped
    expect(text).not.toContain('https://portal.example.com'); // link → text only
    expect(text).toContain('Self-Service-Portal');
    expect(text).toContain('vpnctl install --profile firma-standard'); // fence content verbatim
    expect(text).not.toContain('```');
  });
});

describe('fail-closed handling', () => {
  it('scanned PDF without a text layer → clear error, NO document created', async () => {
    // {ocr: null} = explicitly no provider — keeps this test deterministic
    // regardless of whether ANTHROPIC_API_KEY is set in the local env.
    await expect(
      extractText(
        { filename: 'scan.pdf', mimeType: 'application/pdf', data: fixture('scan.pdf') },
        { ocr: null },
      ),
    ).rejects.toThrow(/Textebene/);

    const docs = await withTenant(ORG, (tx) => tx.document.findMany());
    expect(docs).toHaveLength(0);
    const chunks = await withTenant(ORG, (tx) => tx.$queryRaw<unknown[]>`SELECT 1 FROM "chunks"`);
    expect(chunks).toHaveLength(0);
  });

  it('oversize file (> 20 MB) is rejected before any parsing', async () => {
    const oversize = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(
      extractText({ filename: 'big.txt', mimeType: 'text/plain', data: oversize }),
    ).rejects.toThrow(/20 MB/);
  });

  it('MIME type contradicting the extension is rejected', async () => {
    await expect(
      extractText({ filename: 'sample.pdf', mimeType: 'text/plain', data: fixture('sample.pdf') }),
    ).rejects.toThrow(/MIME/);
  });

  it('unsupported extension is rejected', async () => {
    await expect(
      extractText({ filename: 'malware.exe', mimeType: 'application/octet-stream', data: fixture('sample.txt') }),
    ).rejects.toThrow(/Nicht unterstütztes Format/);
  });

  it('corrupt bytes behind a valid extension are rejected by the parser', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(
      extractText({ filename: 'kaputt.pdf', mimeType: 'application/pdf', data: garbage }),
    ).rejects.toThrow(ExtractionError);
    await expect(
      extractText({
        filename: 'kaputt.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: garbage,
      }),
    ).rejects.toThrow(ExtractionError);
  });
});

describe('paragraph-aware chunking (additive — existing behavior untouched)', () => {
  it('chunks never cut inside a paragraph when every paragraph fits the limit', () => {
    // 14 distinct paragraphs of ~300 chars — several chunks, all cuts at \n\n.
    const paragraphs = Array.from(
      { length: 14 },
      (_, i) => `P${i} ${'Wissensinhalt Absatz Nummer '.repeat(10)}${i}.`,
    );
    const chunks = chunkText(paragraphs.join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      // Every piece of a chunk must be a full original paragraph — except the
      // leading piece, which may be the overlap tail of the previous chunk.
      const pieces = chunk.split('\n\n');
      pieces.forEach((piece, idx) => {
        const isFullParagraph = paragraphs.includes(piece);
        const isOverlapTail = idx === 0 && paragraphs.some((p) => p.endsWith(piece));
        expect(isFullParagraph || isOverlapTail, `unexpected mid-paragraph cut: "${piece.slice(0, 60)}…"`).toBe(true);
      });
    }
  });

  it('a single paragraph over 1200 chars still hard-splits (fallback), at word boundaries', () => {
    const oversize = `${'Grenzfall '.repeat(300)}Ende.`; // ~3000 chars, no \n\n
    const chunks = chunkText(oversize);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A chunk may carry up to `overlap` chars of leading context on top of
      // the 1200-char window (unchanged pre-0005 behavior).
      expect(chunk.length).toBeLessThanOrEqual(1200 + 200 + 2);
      // Word-boundary refinement: no chunk starts or ends mid-word.
      expect(chunk).toMatch(/^\S[\s\S]*\S$/);
      expect(oversize).toContain(chunk.split('\n\n')[0].split(' ')[0]);
      for (const word of chunk.split(/\s+/)) {
        expect(['Grenzfall', 'Ende.']).toContain(word);
      }
    }
  });
});
