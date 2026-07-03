// =============================================================================
// OCR GATE (Phase 17)
//
//   1. With an injected OCR provider, a scanned PDF (no text layer) is
//      transcribed and flows through the EXISTING pipeline — retrieval
//      answers from the OCR text; meta carries ocr:true + pageCount.
//   2. Fail-closed stays: no provider ⇒ rejected exactly as before; provider
//      errors / empty transcription ⇒ clear ExtractionError, nothing written.
//   3. Cost guard: scans beyond OCR_MAX_PAGES are rejected BEFORE any OCR.
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { answerQuestion, ingestDocument } from '../src/lib/rag';
import { extractText } from '../src/lib/ingest/extract';
import { FakeOcrProvider, OCR_MAX_PAGES, type OcrProvider } from '../src/lib/ingest/ocr';

const ORG = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', name)));
}

/** Minimal text-layer-free PDF with `pages` blank pages — enough for pdfjs to
 * count pages and find no text (the shape of a scan). */
function blankScanPdf(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'),
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await withTenant(ORG, (tx) =>
    tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_ocr', name: 'OCR Org' } }),
  );
});

describe('scanned PDF with an OCR provider', () => {
  it('transcribes, marks meta.ocr, and the knowledge answers questions end-to-end', async () => {
    // Single line: the deterministic fake chat provider echoes the first
    // context line, so the assertion below stays exact.
    const ocr = new FakeOcrProvider(
      'Der Hydraulikdruck der Presse drei wurde auf 180 bar eingestellt.',
    );
    const result = await extractText(
      { filename: 'scan.pdf', mimeType: 'application/pdf', data: fixture('scan.pdf') },
      { ocr },
    );
    expect(result.meta.ocr).toBe(true);
    expect(result.meta.format).toBe('pdf');
    expect(result.meta.pageCount).toBeGreaterThan(0);
    expect(result.text).toContain('180 bar');

    await ingestDocument({
      orgId: ORG, actorId: 'ocr-test', title: 'Wartungsprotokoll', source: 'upload',
      text: result.text,
      meta: { sourceFormat: result.meta.format, pageCount: result.meta.pageCount, wordCount: result.meta.wordCount },
    });
    const answer = await answerQuestion({
      orgId: ORG, actorId: 't', question: 'Auf wie viel bar wurde der Hydraulikdruck eingestellt?',
    });
    expect(answer.answer).toContain('180 bar');
  });
});

describe('fail-closed paths', () => {
  it('no provider ⇒ rejected with the clear Textebene error', async () => {
    await expect(
      extractText(
        { filename: 'scan.pdf', mimeType: 'application/pdf', data: fixture('scan.pdf') },
        { ocr: null },
      ),
    ).rejects.toThrow(/Textebene/);
  });

  it('a failing provider ⇒ ExtractionError, never a crash or silent import', async () => {
    const broken: OcrProvider = {
      name: 'broken',
      extractPdfText: async () => {
        throw new Error('api down');
      },
    };
    await expect(
      extractText(
        { filename: 'scan.pdf', mimeType: 'application/pdf', data: fixture('scan.pdf') },
        { ocr: broken },
      ),
    ).rejects.toThrow(/OCR failed/);
  });

  it('an empty transcription ⇒ rejected (no empty document)', async () => {
    await expect(
      extractText(
        { filename: 'scan.pdf', mimeType: 'application/pdf', data: fixture('scan.pdf') },
        { ocr: new FakeOcrProvider('   ') },
      ),
    ).rejects.toThrow(/no readable text/);
  });

  it('cost guard: a scan beyond OCR_MAX_PAGES is rejected BEFORE any OCR call', async () => {
    let called = false;
    const spy: OcrProvider = {
      name: 'spy',
      extractPdfText: async () => {
        called = true;
        return 'x';
      },
    };
    await expect(
      extractText(
        {
          filename: 'big-scan.pdf',
          mimeType: 'application/pdf',
          data: blankScanPdf(OCR_MAX_PAGES + 1),
        },
        { ocr: spy },
      ),
    ).rejects.toThrow(/begrenzt/);
    expect(called).toBe(false); // guard fired before the provider
  });

  it('a NORMAL text PDF never goes through OCR (provider stays untouched)', async () => {
    let called = false;
    const spy: OcrProvider = {
      name: 'spy',
      extractPdfText: async () => {
        called = true;
        return 'x';
      },
    };
    const result = await extractText(
      { filename: 'sample.pdf', mimeType: 'application/pdf', data: fixture('sample.pdf') },
      { ocr: spy },
    );
    expect(result.meta.ocr).toBeUndefined();
    expect(called).toBe(false);
  });
});
