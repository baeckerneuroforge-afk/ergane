// =============================================================================
// KNOWLEDGE-BASE ISOLATION + RAG GATE (Phase 2)
//
// Extends — never replaces — the canonical isolation gate in isolation.test.ts.
// Runs as `app_user` (DATABASE_URL) like the app does; the owner connection is
// used ONLY to reset state. All AI calls use the deterministic FAKE providers —
// CI makes no network calls.
//
// What it proves for documents / chunks / chat_messages:
//   1. Tenant A never sees B's rows — including through the VECTOR similarity
//      query: retrieval for A never returns B's chunks, even when the query
//      matches B's content exactly.
//   2. INSERT with a foreign org_id is rejected (WITH CHECK) on all three.
//   3. Without a tenant context every query returns 0 rows (fails closed).
//   4. RLS ENABLE + FORCE are actually on (regression guard).
//   5. The RAG flow works end-to-end: ingest → grounded answer WITH sources;
//      unanswerable question → the honest "no knowledge" answer; chat history
//      + audit entries are written.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { FakeChatProvider, FakeEmbeddingProvider } from '../src/lib/ai/fake';
import {
  ingestDocument,
  retrieve,
  answerQuestion,
  NO_KNOWLEDGE_ANSWER,
  SOURCES_MARKER,
} from '../src/lib/rag';
import { toVectorLiteral } from '../src/lib/rag/ingest';

const ORG_A = '33333333-3333-4333-8333-333333333333';
const ORG_B = '44444444-4444-4444-8444-444444444444';
const NEW_TABLES = ['documents', 'chunks', 'chat_messages'];
const ALL_TABLES = ['organizations', 'memberships', 'knowledge_items', 'audit_log', ...NEW_TABLES];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const embedder = new FakeEmbeddingProvider();
const chat = new FakeChatProvider();

// Distinctive vocabulary per tenant so the fake bag-of-words embedder produces
// meaningful similarities.
const DOC_A = {
  title: 'Urlaubsrichtlinie 2026',
  text: 'Alle Mitarbeitenden in Deutschland haben 30 Urlaubstage pro Jahr. Resturlaub verfällt am 31. März des Folgejahres.',
};
const DOC_B = {
  title: 'Gehaltsbänder vertraulich',
  text: 'Die vertraulichen Gehaltsbänder für Senior Engineers liegen zwischen 90000 und 120000 Euro jährlich.',
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
  });
}

beforeAll(async () => {
  // Same precondition as the canonical gate: refuse to "pass" as a privileged role.
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Refusing to run: connected as "${role?.current_user}" (super=${role?.rolsuper}, bypassrls=${role?.rolbypassrls}).`,
    );
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
  await seedOrg(ORG_A, 'org_rag_a', 'RAG Org A');
  await seedOrg(ORG_B, 'org_rag_b', 'RAG Org B');
  await ingestDocument({ orgId: ORG_A, actorId: 'user_a', source: 'manual', embedder, ...DOC_A });
  await ingestDocument({ orgId: ORG_B, actorId: 'user_b', source: 'manual', embedder, ...DOC_B });
});

describe('knowledge-base tenant isolation (documents, chunks, chat_messages)', () => {
  it('regression guard: RLS is ENABLEd AND FORCEd on all three new tables', async () => {
    const rows = await admin.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ANY(${NEW_TABLES}) AND relkind = 'r'`;
    expect(rows).toHaveLength(NEW_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS ENABLEd`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} must have RLS FORCEd`).toBe(true);
    }
  });

  it('tenant A sees only its own documents / chunks / chat_messages', async () => {
    await answerQuestion({ orgId: ORG_B, actorId: 'user_b', question: 'Gehaltsbänder Senior Engineers?', embedder, chat });

    const [docs, chunkRows, msgs] = await withTenant(ORG_A, async (tx) => [
      await tx.document.findMany(),
      await tx.$queryRaw<Array<{ content: string }>>`SELECT "content" FROM "chunks"`,
      await tx.chatMessage.findMany(),
    ] as const);

    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe(DOC_A.title);
    expect(chunkRows.length).toBeGreaterThan(0);
    for (const c of chunkRows) expect(c.content).not.toContain('Gehaltsbänder');
    expect(msgs).toHaveLength(0); // B's chat never shows up in A
  });

  it('VECTOR retrieval for A never returns B chunks — even for a query matching B verbatim', async () => {
    // The query IS tenant B's content. Similarity to B's chunk would be ~1.0;
    // it must still be invisible to A.
    const results = await retrieve({ orgId: ORG_A, query: DOC_B.text, embedder });
    for (const r of results) {
      expect(r.content).not.toContain('Gehaltsbänder');
      expect(r.documentTitle).toBe(DOC_A.title);
    }

    // Positive control: B itself finds it with near-perfect similarity.
    const own = await retrieve({ orgId: ORG_B, query: DOC_B.text, embedder });
    expect(own.length).toBeGreaterThan(0);
    expect(own[0]?.content).toContain('Gehaltsbänder');
    expect(own[0]?.similarity).toBeGreaterThan(0.9);
  });

  it('INSERT with a foreign org_id is rejected by WITH CHECK on all three tables', async () => {
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.document.create({ data: { orgId: ORG_B, title: 'smuggled', source: 'manual' } }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(ORG_A, (tx) =>
        tx.chatMessage.create({ data: { orgId: ORG_B, role: 'user', content: 'smuggled' } }),
      ),
    ).rejects.toThrow();

    // chunks: raw insert (vector column) pointing at B's own document.
    const [vec] = await embedder.embed(['smuggled'], 'document');
    const bDoc = await withTenant(ORG_B, (tx) => tx.document.findFirstOrThrow());
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.$executeRaw`INSERT INTO "chunks" ("org_id", "document_id", "content", "embedding", "ord")
          VALUES (${ORG_B}::uuid, ${bDoc.id}::uuid, ${'smuggled'}, ${toVectorLiteral(vec)}::vector, ${999})`,
      ),
    ).rejects.toThrow();
  });

  it('without a tenant context every query returns 0 rows — vector query included (fails closed)', async () => {
    // Bare client, no withTenant: RLS predicate collapses to NULL.
    expect(await prisma.document.findMany()).toHaveLength(0);
    expect(await prisma.chatMessage.findMany()).toHaveLength(0);

    const [vec] = await embedder.embed([DOC_A.text], 'query');
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "chunks" ORDER BY "embedding" <=> ${toVectorLiteral(vec)}::vector LIMIT 10`;
    expect(rows).toHaveLength(0);
  });
});

describe('RAG flow (fake providers — no network)', () => {
  it('answerable question → grounded answer WITH the document title as source', async () => {
    const result = await answerQuestion({
      orgId: ORG_A,
      actorId: 'user_a',
      question: 'Wie viele Urlaubstage haben Mitarbeitende in Deutschland?',
      embedder,
      chat,
    });

    expect(result.answer).not.toBe(NO_KNOWLEDGE_ANSWER);
    // Canonical sources format: the grounded answer ENDS with the marked line.
    expect(result.answer.endsWith(`${SOURCES_MARKER} ${DOC_A.title}`)).toBe(true);
    expect(result.sources).toEqual([DOC_A.title]);

    // Both messages persisted in A's history; the stored answer carries the sources line.
    const msgs = await withTenant(ORG_A, (tx) =>
      tx.chatMessage.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1]?.content).toContain(`Quellen: ${DOC_A.title}`);
  });

  it('question with no matching knowledge → honest "kein geprüftes Wissen" answer, no sources', async () => {
    const result = await answerQuestion({
      orgId: ORG_A,
      actorId: 'user_a',
      question: 'Welche Raumtemperatur herrscht auf dem Jupitermond Europa?',
      embedder,
      chat,
    });

    expect(result.answer).toBe(NO_KNOWLEDGE_ANSWER);
    expect(result.sources).toEqual([]);
    expect(result.usedChunks).toEqual([]);
  });

  it('ingestion and answering write audit entries (actor_type agent)', async () => {
    await answerQuestion({ orgId: ORG_A, actorId: 'user_a', question: 'Urlaubstage Deutschland?', embedder, chat });

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('knowledge.ingested');
    expect(actions).toContain('chat.answered');
    for (const entry of audit) expect(entry.actorType).toBe('agent');
    expect(audit.find((a) => a.action === 'knowledge.ingested')?.target).toBe(DOC_A.title);
  });

  it('multi-paragraph text is chunked (>1 chunk) and every chunk carries the org', async () => {
    const longText = Array.from({ length: 12 }, (_, i) =>
      `Absatz ${i}: ${'Dies ist ein längerer Wissensabsatz über interne Prozesse. '.repeat(4)}`,
    ).join('\n\n');
    const { chunkCount } = await ingestDocument({
      orgId: ORG_A, actorId: 'user_a', title: 'Prozesshandbuch', source: 'upload', text: longText, embedder,
    });
    expect(chunkCount).toBeGreaterThan(1);

    const rows = await withTenant(ORG_A, (tx) =>
      tx.$queryRaw<Array<{ org_id: string }>>`
        SELECT c."org_id" FROM "chunks" c
        JOIN "documents" d ON d."id" = c."document_id"
        WHERE d."title" = 'Prozesshandbuch'`,
    );
    expect(rows).toHaveLength(chunkCount);
    for (const r of rows) expect(r.org_id).toBe(ORG_A);
  });
});
