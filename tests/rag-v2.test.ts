// =============================================================================
// RAG V2 GATE (Phase 10) — multi-turn history + document re-ingest.
//
//   1. Multi-turn: answerQuestion feeds history turns into the LLM prompt;
//      retrieval still uses ONLY the current question (disclosure invariant).
//   2. loadChatHistory is per ACTOR: other users' turns and pre-0010 rows
//      (actor_id NULL) never load — prompt history cannot leak another
//      person's disclosed knowledge.
//   3. Re-ingest: same document id, old content gone from retrieval, new
//      content found; tenant-scoped; audited as knowledge.reingested.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import type { ChatCompletionRequest, ChatProvider } from '../src/lib/ai/types';
import {
  answerQuestion,
  ingestDocument,
  loadChatHistory,
  NO_KNOWLEDGE_ANSWER,
} from '../src/lib/rag';

const ORG_A = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ORG_B = 'abababab-abab-4bab-8bab-abababababab';
const LEAD = 'rv_lead';
const MEMBER = 'rv_member';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_rv_a', name: 'RagV2 A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: LEAD, role: 'lead' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER, role: 'member' } });
    await tx.visibilityGrant.create({ data: { orgId: ORG_A, level: 'confidential', role: 'lead' } });
  });
  await withTenant(ORG_B, (tx) =>
    tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_rv_b', name: 'RagV2 B' } }),
  );
}

/** Chat provider spy: records every completion request, answers fixed. */
function chatSpy(reply = 'Antwort aus dem Spy.') {
  const requests: ChatCompletionRequest[] = [];
  const provider: ChatProvider = {
    name: 'spy',
    complete: async (req) => {
      requests.push(req);
      return reply;
    },
  };
  return { requests, provider };
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
  await seed();
});

// --- 1. multi-turn ----------------------------------------------------------------

describe('multi-turn answering', () => {
  it('history turns are fed into the prompt BEFORE the current question', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Urlaubsrichtlinie', source: 'manual',
      text: 'Alle Mitarbeitenden haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
    });

    const { requests, provider } = chatSpy();
    await answerQuestion({
      orgId: ORG_A,
      actorId: LEAD,
      question: 'Wie viele Urlaubstage pro Kalenderjahr?',
      role: 'lead',
      chat: provider,
      history: [
        { role: 'user', content: 'Hallo, ich habe Fragen zur Urlaubsrichtlinie.' },
        { role: 'assistant', content: 'Gern — was möchtest du wissen?' },
      ],
    });

    expect(requests).toHaveLength(1);
    const messages = requests[0]!.messages;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hallo, ich habe Fragen zur Urlaubsrichtlinie.' });
    expect(messages[1]!.role).toBe('assistant');
    // The FINAL message carries the retrieval context for the CURRENT question.
    expect(messages[2]!.content).toContain('Context passages');
    expect(messages[2]!.content).toContain('30 Urlaubstage');
    // History carries NO retrieval context — retrieval used only the question.
    expect(messages[0]!.content).not.toContain('Context passages');
  });

  it('persists chat turns with the actor id (basis of per-actor history)', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Doc', source: 'manual',
      text: 'Kaffee ist in der Küche im dritten Stock.',
    });
    await answerQuestion({ orgId: ORG_A, actorId: LEAD, question: 'Wo ist der Kaffee?', role: 'lead' });

    const rows = await withTenant(ORG_A, (tx) => tx.chatMessage.findMany());
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.actorId).toBe(LEAD);
  });
});

// --- 2. per-actor history -----------------------------------------------------------

describe('loadChatHistory (per actor, fail-closed)', () => {
  it('returns only the OWN actor’s turns, oldest first, limited', async () => {
    await withTenant(ORG_A, async (tx) => {
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'lead-frage', actorId: LEAD } });
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'assistant', content: 'lead-antwort GEHEIM', actorId: LEAD } });
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'member-frage', actorId: MEMBER } });
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'legacy ohne actor' } });
    });

    const memberHistory = await loadChatHistory(ORG_A, MEMBER);
    expect(memberHistory).toEqual([{ role: 'user', content: 'member-frage' }]);
    // The member's history NEVER contains the lead's (possibly confidential)
    // answers — and legacy rows without an actor never load for anyone.
    expect(JSON.stringify(memberHistory)).not.toContain('GEHEIM');
    expect(JSON.stringify(memberHistory)).not.toContain('legacy');

    const leadHistory = await loadChatHistory(ORG_A, LEAD);
    expect(leadHistory.map((t) => t.role)).toEqual(['user', 'assistant']);

    expect(await loadChatHistory(ORG_A, '')).toEqual([]);
  });

  it('confidential knowledge cannot reach a member via prompt history (end-to-end)', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Gehaltsbänder', source: 'manual',
      visibility: 'confidential',
      text: 'Das Gehaltsband für Senior Engineers liegt bei 95000 Euro Jahresgehalt.',
    });

    // The lead asks and receives the confidential answer (grant exists).
    const leadResult = await answerQuestion({
      orgId: ORG_A, actorId: LEAD, question: 'Wie hoch ist das Gehaltsband für Senior Engineers?', role: 'lead',
    });
    expect(leadResult.answer).toContain('95000');

    // The member asks the same — their own history is empty, retrieval is
    // role-gated, so NOTHING about the salary band reaches the prompt.
    const { requests, provider } = chatSpy();
    const memberHistory = await loadChatHistory(ORG_A, MEMBER);
    const memberResult = await answerQuestion({
      orgId: ORG_A, actorId: MEMBER, question: 'Wie hoch ist das Gehaltsband für Senior Engineers?',
      role: 'member', chat: provider, history: memberHistory,
    });
    expect(memberResult.answer).toBe(NO_KNOWLEDGE_ANSWER);
    expect(requests).toHaveLength(0); // no relevant chunks ⇒ LLM never called
  });
});

// --- 3. re-ingest ---------------------------------------------------------------------

describe('re-ingest (document versioning)', () => {
  it('replaces content under the SAME id; old version is no longer retrieved', async () => {
    const { documentId } = await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Reisekosten', source: 'manual',
      text: 'Hotelübernachtungen werden bis 120 Euro pro Nacht erstattet.',
    });

    const v2 = await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Reisekosten (v2)', source: 'manual',
      text: 'Hotelübernachtungen werden bis 150 Euro pro Nacht erstattet.',
      replaceDocumentId: documentId,
    });
    expect(v2.documentId).toBe(documentId); // same identity

    const docs = await withTenant(ORG_A, (tx) => tx.document.findMany());
    expect(docs).toHaveLength(1); // no duplicate
    expect(docs[0]!.title).toBe('Reisekosten (v2)');

    const answer = await answerQuestion({
      orgId: ORG_A, actorId: 't', question: 'Bis zu welchem Betrag werden Hotelübernachtungen erstattet?',
    });
    expect(answer.answer).toContain('150 Euro');
    expect(answer.answer).not.toContain('120 Euro');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'knowledge.reingested' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('keeps the existing visibility unless a new one is given', async () => {
    const { documentId } = await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Vertraulich', source: 'manual',
      visibility: 'confidential', text: 'Geheimer Inhalt Version eins.',
    });
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Vertraulich', source: 'manual',
      text: 'Geheimer Inhalt Version zwei.', replaceDocumentId: documentId,
    });
    const doc = await withTenant(ORG_A, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: documentId } }),
    );
    expect(doc.visibility).toBe('confidential'); // fail-closed: stays protected
  });

  it('is tenant-scoped: A cannot replace B’s document', async () => {
    const bDoc = await ingestDocument({
      orgId: ORG_B, actorId: 'seed', title: 'B-Doku', source: 'manual', text: 'Inhalt von B.',
    });
    await expect(
      ingestDocument({
        orgId: ORG_A, actorId: 'seed', title: 'Hijack', source: 'manual',
        text: 'Übernahme.', replaceDocumentId: bDoc.documentId,
      }),
    ).rejects.toThrow();
    const bStill = await withTenant(ORG_B, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: bDoc.documentId } }),
    );
    expect(bStill.title).toBe('B-Doku');
  });
});
