// =============================================================================
// `pnpm demo:ingest` — multi-format ingestion (Phase 5) WITHOUT HTTP/login.
//
// Extracts each fixture (.pdf/.docx/.md/.txt) through the extraction layer,
// ingests the text through the EXISTING pipeline (chunking → embeddings →
// atomic write → audit), then asks a question whose answer lives in the PDF
// and shows the canonical "Quellen: …" line.
//
// Providers: real adapters with ANTHROPIC_API_KEY / VOYAGE_API_KEY set,
// deterministic fakes otherwise (no network) — same factory as the app.
// =============================================================================
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { getChatProvider, getEmbeddingProvider } from '../src/lib/ai';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER } from '../src/lib/rag';
import { extractText } from '../src/lib/ingest/extract';

// Fixed UUID → idempotent, same pattern as demo-rag.ts.
const DEMO_ORG = '66666666-6666-4666-8666-666666666666';
const ACTOR = 'demo-ingest';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const FILES: Array<{ file: string; mime: string; title: string }> = [
  { file: 'sample.pdf', mime: 'application/pdf', title: 'Vertragsbedingungen (PDF)' },
  {
    file: 'sample.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    title: 'Homeoffice-Regelung (DOCX)',
  },
  { file: 'sample.md', mime: 'text/markdown', title: 'Onboarding-Leitfaden (MD)' },
  { file: 'sample.txt', mime: 'text/plain', title: 'Spesenrichtlinie (TXT)' },
];

// The answer to this lives ONLY in the PDF fixture.
const PDF_QUESTION = 'Wie lange ist die Kuendigungsfrist im Wartungsvertrag?';

async function main() {
  console.log(
    `Providers: embeddings=${getEmbeddingProvider().name}, chat=${getChatProvider().name}` +
      ' (set VOYAGE_API_KEY / ANTHROPIC_API_KEY to use the real ones)',
  );

  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.upsert({
      where: { id: DEMO_ORG },
      create: { id: DEMO_ORG, clerkOrgId: 'demo_org_ingest', name: 'Demo Org Ingest' },
      update: {},
    });
  });

  for (const f of FILES) {
    const existing = await withTenant(DEMO_ORG, (tx) =>
      tx.document.findFirst({ where: { title: f.title } }),
    );
    if (existing) {
      console.log(`📄  "${f.title}" ist bereits ingestiert — überspringe.`);
      continue;
    }
    const { text, meta } = await extractText({
      filename: f.file,
      mimeType: f.mime,
      data: new Uint8Array(readFileSync(join(FIXTURES, f.file))),
    });
    const { chunkCount } = await ingestDocument({
      orgId: DEMO_ORG,
      actorId: ACTOR,
      title: f.title,
      source: 'upload',
      text,
      meta: { sourceFormat: meta.format, pageCount: meta.pageCount, wordCount: meta.wordCount },
    });
    console.log(
      `📄  Ingestiert: "${f.title}" — Format ${meta.format}, ` +
        `${meta.pageCount != null ? `${meta.pageCount} Seiten, ` : ''}${meta.wordCount} Wörter → ${chunkCount} Chunks`,
    );
  }

  console.log(`\n❓  ${PDF_QUESTION}`);
  const { answer, sources } = await answerQuestion({
    orgId: DEMO_ORG,
    actorId: ACTOR,
    question: PDF_QUESTION,
  });
  console.log(`💬  ${answer.split('\n').join('\n    ')}`);

  if (answer === NO_KNOWLEDGE_ANSWER || sources.length === 0) {
    throw new Error('DEMO FAILED: die PDF-Frage lieferte keine Antwort mit Quelle.');
  }
  if (!sources.includes('Vertragsbedingungen (PDF)')) {
    throw new Error(`DEMO FAILED: Quelle ist nicht das PDF (sources: ${sources.join(', ')}).`);
  }

  console.log('\n✅  Demo erfolgreich: Antwort kommt MIT Quellen-Zeile aus dem PDF.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
