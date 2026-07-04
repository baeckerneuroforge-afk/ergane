// =============================================================================
// MEMORY / HISTORY: Schritt 3 — helix lädt die Kunden-Historie und baut darauf auf
//
// Beweist die fünf tragenden Eigenschaften (Definition of Done):
//
//   (a) Mit client_id und vorhandener Historie fließt die Historie in den Prompt.
//   (b) Ohne client_id läuft der Skill wie bisher (kein Bruch).
//   (c) Das Historie-Laden inkl. Blob-Get passiert AUSSERHALB der Tx
//       (app.current_org null zum Zeitpunkt des LLM-Calls + Blob-Gets).
//   (d) Tenant-isoliert: Historie eines Kunden von Org A ist für einen Lauf
//       in Org B nicht ladbar.
//   (e) Begrenzung greift (nicht unbegrenzt viele Deliverables im Kontext).
//
// Harness: identisch zum skill-transkript-framework.test.ts — app_user, Owner-
// Connection nur zum Reset, deterministischer InstrumentedFakeChat.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, startRun } from '../src/lib/skills';
import { __setChatProviderForTests, type ChatCompletionRequest, type ChatProvider } from '../src/lib/ai';
import { ingestDocument } from '../src/lib/rag';
import { createArtifact } from '../src/lib/artifacts';
import { getFakeBlobProvider } from '../src/lib/storage/blob';
import { getClientHistory } from '../src/lib/memory/history';

const ORG_A = 'fafafafa-fafa-4afa-8afa-fafafafa0001';
const ORG_B = 'fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfb0001';
const APPROVER = 'mh_lead';
const ADMIN_A = 'mh_admin_a';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'clients', 'artifacts',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fakeBlob = getFakeBlobProvider();

const TRANSCRIPT_A = [
  'Kickoff-Transkript Kunde Nordwind: der Kunde will die Produkteinführung seiner',
  'neuen Logistik-Software beschleunigen. Kernthema Onboarding der Lager-Teams,',
  'Automatisierung der Wareneingangs-Buchung und ein klarer Rollout-Plan.',
  'Der Kunde nannte drei Wünsche: Schulungen, Dashboards und einen Pilotstandort.',
].join(' ');

class InstrumentedFakeChat implements ChatProvider {
  readonly name = 'instrumented-fake';
  readonly calls: Array<{ orgContextDuringCall: string | null; lastUser: string }> = [];

  reset(): void {
    this.calls.length = 0;
  }

  async complete(req: ChatCompletionRequest): Promise<string> {
    const [{ org }] = await prisma.$queryRaw<Array<{ org: string | null }>>`
      SELECT current_setting('app.current_org', true) AS org
    `;
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    this.calls.push({ orgContextDuringCall: org && org.length > 0 ? org : null, lastUser });

    const titles = [...lastUser.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const firstTitle = titles[0] ?? 'transcript';
    return [
      `Executive summary: based on ${titles.length} transcript excerpt(s), here is the framework.`,
      '',
      '## Situation',
      `Grounded in ${firstTitle}.`,
      '',
      '## Key themes & goals',
      '- Self-service for the top requests',
      '',
      '## Constraints',
      '- Read-only legacy access',
      '',
      '## Prioritized use cases',
      '1. Self-service portal',
      '',
      '## Next steps',
      '1. Scope the pilot',
    ].join('\n');
  }
}

const fakeChat = new InstrumentedFakeChat();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  fakeBlob.reset();
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.create({ data: { orgId, userId: APPROVER, role: 'lead' } });
    await tx.membership.create({ data: { orgId, userId: ADMIN_A, role: 'admin' } });
  });
}

async function createTestClient(orgId: string, name: string, notes?: string | null): Promise<string> {
  const client = await withTenant(orgId, async (tx) => {
    return tx.client.create({ data: { orgId, name, notes: notes ?? null } });
  });
  return client.id;
}

async function stepDetail(orgId: string, runId: string, name: string): Promise<Record<string, unknown>> {
  const step = await withTenant(orgId, (tx) =>
    tx.skillStep.findFirstOrThrow({ where: { runId, name } }),
  );
  return (step.detail ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  __setChatProviderForTests(fakeChat);
  await reset();
});

afterAll(async () => {
  __setChatProviderForTests(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  fakeChat.reset();
  await reset();
  await seedOrg(ORG_A, 'org_mh_a', 'Memory Org A');
  await seedOrg(ORG_B, 'org_mh_b', 'Memory Org B');
});

afterEach(() => {
  fakeChat.reset();
});

// --- (a) mit client_id und vorhandener Historie fließt sie in den Prompt ---

describe('(a) history flows into the LLM prompt when client_id is set', () => {
  it('prior deliverable content + client notes appear in the LLM prompt', async () => {
    const clientId = await createTestClient(ORG_A, 'Nordwind GmbH', 'Key account, logistics sector');

    // Create a prior artifact for this client (simulates a previous framework run).
    const priorContent = '# Framework — Nordwind Phase 1\n\n## Executive Summary\nInitial assessment done.';
    await createArtifact({
      orgId: ORG_A,
      title: 'Framework — Nordwind Phase 1',
      type: 'framework',
      clientId,
      bytes: new TextEncoder().encode(priorContent),
      contentType: 'text/markdown',
    });

    // Create a prior completed run linked to the client.
    await withTenant(ORG_A, async (tx) => {
      await tx.skillRun.create({
        data: {
          orgId: ORG_A,
          skillKey: 'transkript_zu_framework',
          status: 'completed',
          clientId,
          input: { thema: 'Nordwind Phase 1' },
          result: { generiert: true },
        },
      });
    });

    // Ingest a transcript so the skill has retrieval context.
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    // Start a NEW run WITH client_id — should load history.
    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Nordwind Phase 2',
      fokus: 'Vertiefung',
    }, { clientId });
    expect(handle.status).toBe('awaiting_approval');

    // The LLM prompt must contain the history block.
    expect(fakeChat.calls).toHaveLength(1);
    const prompt = fakeChat.calls[0]!.lastUser;
    expect(prompt).toContain('PRIOR WORK WITH THIS CLIENT');
    expect(prompt).toContain('Nordwind GmbH');
    expect(prompt).toContain('Key account, logistics sector');
    expect(prompt).toContain('Framework — Nordwind Phase 1');
    expect(prompt).toContain('Initial assessment done.');
    expect(prompt).toContain('transkript_zu_framework');
    expect(prompt).toContain('Build on this prior work');
  });
});

// --- (b) without client_id: skill works exactly as before ---

describe('(b) without client_id the skill works unchanged', () => {
  it('no history block in prompt when no clientId', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Nordwind Phase 1',
      fokus: 'Produkteinführung',
    });
    expect(handle.status).toBe('awaiting_approval');

    expect(fakeChat.calls).toHaveLength(1);
    const prompt = fakeChat.calls[0]!.lastUser;
    expect(prompt).not.toContain('PRIOR WORK');
    expect(prompt).not.toContain('FRÜHERE ARBEIT');
    // Normal transcript context is present.
    expect(prompt).toContain('Kickoff Nordwind');
  });
});

// --- (c) history + blob loading outside Tx ---

describe('(c) history loading + blob-get happen outside the tenant transaction', () => {
  it('app.current_org is null during the LLM call (blob-get + history loaded in prepare, not in Tx)', async () => {
    const clientId = await createTestClient(ORG_A, 'Nordwind GmbH');

    await createArtifact({
      orgId: ORG_A,
      title: 'Prior Framework',
      type: 'framework',
      clientId,
      bytes: new TextEncoder().encode('Prior content'),
      contentType: 'text/markdown',
    });

    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Nordwind Phase 2',
      fokus: 'Follow-up',
    }, { clientId });
    expect(handle.status).toBe('awaiting_approval');

    // The LLM call saw history content (blob was loaded)…
    expect(fakeChat.calls).toHaveLength(1);
    expect(fakeChat.calls[0]!.lastUser).toContain('Prior content');
    // …and NO tenant Tx was active at the time of the call.
    expect(fakeChat.calls[0]!.orgContextDuringCall).toBeNull();
  });
});

// --- (d) tenant isolation: Org B cannot see Org A's client history ---

describe('(d) tenant isolation — history of Org A client not visible to Org B', () => {
  it('getClientHistory returns empty for a client belonging to another org', async () => {
    const clientIdA = await createTestClient(ORG_A, 'Nordwind GmbH', 'Secret notes for A');

    await createArtifact({
      orgId: ORG_A,
      title: 'Secret Framework A',
      type: 'framework',
      clientId: clientIdA,
      bytes: new TextEncoder().encode('Confidential A content'),
      contentType: 'text/markdown',
    });

    await withTenant(ORG_A, async (tx) => {
      await tx.skillRun.create({
        data: {
          orgId: ORG_A,
          skillKey: 'transkript_zu_framework',
          status: 'completed',
          clientId: clientIdA,
          input: { thema: 'A-only' },
        },
      });
    });

    // Org A sees its own history.
    const historyA = await getClientHistory(clientIdA, ORG_A);
    expect(historyA.clientName).toBe('Nordwind GmbH');
    expect(historyA.runs.length).toBeGreaterThan(0);
    expect(historyA.deliverables.length).toBeGreaterThan(0);
    expect(historyA.notes).toBe('Secret notes for A');

    // Org B CANNOT see Org A's client (RLS blocks).
    const historyB = await getClientHistory(clientIdA, ORG_B);
    expect(historyB.clientName).toBe('');
    expect(historyB.runs).toHaveLength(0);
    expect(historyB.deliverables).toHaveLength(0);
    expect(historyB.notes).toBeNull();
  });
});

// --- (e) bounded: not unlimited deliverables in context ---

describe('(e) deliverable count is bounded', () => {
  it('at most 5 deliverables are loaded even when more exist', async () => {
    const clientId = await createTestClient(ORG_A, 'Prolific Client');

    // Create 8 artifacts with distinct slugs.
    for (let i = 0; i < 8; i++) {
      await createArtifact({
        orgId: ORG_A,
        title: `Deliverable ${i}`,
        type: 'framework',
        clientId,
        bytes: new TextEncoder().encode(`Content ${i}`),
        contentType: 'text/markdown',
      });
    }

    const history = await getClientHistory(clientId, ORG_A);
    expect(history.deliverables.length).toBeLessThanOrEqual(5);
    expect(history.deliverables.length).toBe(5);
  });

  it('at most 10 runs are loaded', async () => {
    const clientId = await createTestClient(ORG_A, 'Busy Client');

    await withTenant(ORG_A, async (tx) => {
      for (let i = 0; i < 15; i++) {
        await tx.skillRun.create({
          data: {
            orgId: ORG_A,
            skillKey: `skill_${i}`,
            status: 'completed',
            clientId,
            input: {},
          },
        });
      }
    });

    const history = await getClientHistory(clientId, ORG_A);
    expect(history.runs.length).toBeLessThanOrEqual(10);
    expect(history.runs.length).toBe(10);
  });
});
