// =============================================================================
// `pnpm demo:rag` — the full knowledge-base pipeline WITHOUT HTTP/login.
//
// Clerk is integrated but not configured in this phase, so this script proves
// the Definition of Done directly through the same code paths the UI uses:
// withTenant → ingestDocument → answerQuestion, including audit entries.
//
// Providers: with ANTHROPIC_API_KEY / VOYAGE_API_KEY set it uses the real
// adapters; without keys it falls back to the deterministic fakes (no network).
// The selection is exactly the factory in src/lib/ai — nothing demo-specific.
// =============================================================================
import 'dotenv/config'; // load DATABASE_URL (+ optional AI keys) from .env
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { getChatProvider, getEmbeddingProvider } from '../src/lib/ai';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER } from '../src/lib/rag';

// Fixed UUID → idempotent, same pattern as prisma/seed.ts.
const DEMO_ORG = '55555555-5555-4555-8555-555555555555';
const ACTOR = 'demo-rag';

const DEMO_DOC = {
  title: 'Urlaubsrichtlinie 2026',
  text: [
    'Alle Mitarbeitenden in Deutschland haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
    'Resturlaub muss bis zum 31. März des Folgejahres genommen werden, danach verfällt er.',
    'Urlaubsanträge werden über das HR-Portal gestellt und von der Teamleitung freigegeben.',
  ].join('\n\n'),
};

const ANSWERABLE = 'Wie viele Urlaubstage haben Mitarbeitende in Deutschland?';
const UNANSWERABLE = 'Wie hoch ist die Reisekostenpauschale für Dienstreisen nach Japan?';

async function ask(question: string) {
  console.log(`\n❓  ${question}`);
  const { answer, sources } = await answerQuestion({
    orgId: DEMO_ORG,
    actorId: ACTOR,
    question,
  });
  console.log(`💬  ${answer}`);
  if (sources.length > 0) {
    console.log(`📚  Quellen: ${sources.join('; ')}`);
  } else {
    console.log('📚  Quellen: (keine — kein geprüftes Wissen)');
  }
  return { answer, sources };
}

async function main() {
  console.log(
    `Providers: embeddings=${getEmbeddingProvider().name}, chat=${getChatProvider().name}` +
      ' (set VOYAGE_API_KEY / ANTHROPIC_API_KEY to use the real ones)',
  );

  // 1. Demo org (idempotent, seed pattern — organizations is self-row RLS'd).
  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.upsert({
      where: { id: DEMO_ORG },
      create: { id: DEMO_ORG, clerkOrgId: 'demo_org_rag', name: 'Demo Org RAG' },
      update: {},
    });
  });

  // 2. Ingest the sample document (skip if this run already happened).
  const existing = await withTenant(DEMO_ORG, (tx) =>
    tx.document.findFirst({ where: { title: DEMO_DOC.title } }),
  );
  if (existing) {
    console.log(`\n📄  Dokument "${DEMO_DOC.title}" ist bereits ingestiert — überspringe.`);
  } else {
    const { documentId, chunkCount } = await ingestDocument({
      orgId: DEMO_ORG,
      actorId: ACTOR,
      title: DEMO_DOC.title,
      source: 'manual',
      text: DEMO_DOC.text,
    });
    console.log(`\n📄  Ingestiert: "${DEMO_DOC.title}" (${chunkCount} Chunks, id ${documentId})`);
  }

  // 3. Answerable question → must return an answer WITH sources.
  const good = await ask(ANSWERABLE);
  if (good.answer === NO_KNOWLEDGE_ANSWER || good.sources.length === 0) {
    throw new Error('DEMO FAILED: the answerable question returned no sourced answer.');
  }

  // 4. Unanswerable question → must return the honest no-knowledge answer.
  const none = await ask(UNANSWERABLE);
  if (none.sources.length !== 0) {
    throw new Error('DEMO FAILED: the unanswerable question claimed sources.');
  }

  // 5. Show the audit trail this produced.
  const audit = await withTenant(DEMO_ORG, (tx) =>
    tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
  );
  console.log('\n🧾  Audit-Einträge (append-only, tenant-scoped):');
  for (const a of audit) {
    console.log(`    ${a.createdAt.toISOString()}  ${a.actorType}/${a.actorId}  ${a.action}  → ${a.target ?? ''}`);
  }

  console.log('\n✅  Demo erfolgreich: Antwort mit Quelle UND ehrliche Kein-Wissen-Antwort.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
