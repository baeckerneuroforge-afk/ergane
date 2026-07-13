// =============================================================================
// TRANSKRIPT → USE CASES: second generative deliverable skill (P1-A)
// Engine path: start → prepare LLM outside tx → approval → artifact type use_cases
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, startRun } from '../src/lib/skills';
import { __setChatProviderForTests, type ChatCompletionRequest, type ChatProvider } from '../src/lib/ai';
import { ingestDocument } from '../src/lib/rag';
import { getBlobProvider } from '../src/lib/storage/blob';
import { USE_CASES_GUARDRAIL_REASON } from '../src/lib/skills/catalog/transkript_zu_use_cases';
import { useCasesCriteria } from '../src/lib/loop/criteria/use_cases';

const ORG = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const APPROVER = 'uc_lead';

const ALL_TABLES = [
  'organizations',
  'memberships',
  'knowledge_items',
  'audit_log',
  'documents',
  'chunks',
  'chat_messages',
  'skill_runs',
  'skill_steps',
  'approvals',
  'approval_policies',
  'visibility_grants',
  'artifacts',
  'org_settings',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// Shared vocabulary with thema so bag-of-words fake embeddings retrieve hits.
const TRANSCRIPT = [
  'Kickoff-Transkript Kunde Nordwind: der Kunde will die Produkteinführung seiner',
  'neuen Logistik-Software beschleunigen. Kernthema Onboarding der Lager-Teams,',
  'Automatisierung der Wareneingangs-Buchung und ein klarer Rollout-Plan.',
  'Der Kunde nannte drei Wünsche: Schulungen, Dashboards und einen Pilotstandort.',
  'warehouse logistics pilot onboarding automation inventory dashboard.',
].join(' ');

class UseCasesFakeChat implements ChatProvider {
  readonly name = 'use-cases-fake';
  readonly calls: Array<{ orgContextDuringCall: string | null }> = [];

  async complete(req: ChatCompletionRequest): Promise<string> {
    const [{ org }] = await prisma.$queryRaw<Array<{ org: string | null }>>`
      SELECT current_setting('app.current_org', true) AS org
    `;
    this.calls.push({ orgContextDuringCall: org && org.length > 0 ? org : null });
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const titles = [...lastUser.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    return [
      '## Executive summary',
      `Based on ${titles.length} excerpt(s), prioritize three use cases.`,
      '',
      '## Prioritized use cases',
      '1. **Self-service stock portal** — reduce manager phone time.',
      '2. **Scan-based goods receipt** — cut dock errors.',
      '3. **Cross-site inventory dashboard** — balance stock.',
      '',
      '## Risks & open questions',
      '- Legacy ERP API limits',
      '',
      '## Next steps',
      '1. Scope pilot site',
      '2. Confirm API access',
      '3. Define success metrics',
    ].join('\n');
  }
}

const fake = new UseCasesFakeChat();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await reset();
});

afterAll(async () => {
  __setChatProviderForTests(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  __setChatProviderForTests(fake);
  fake.calls.length = 0;
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_use_cases', name: 'Use Cases Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
  // Default visibility 'open' so lead (and role-less) retrieval sees transcripts
  // without a visibility_grant — same as skill-transkript-framework.test.ts.
  await ingestDocument({
    orgId: ORG,
    actorId: APPROVER,
    title: 'Kickoff Nordwind',
    source: 'transcript',
    text: TRANSCRIPT,
  });
});

afterEach(() => {
  __setChatProviderForTests(null);
});

describe('transkript_zu_use_cases engine path', () => {
  it('pauses for approval, LLM runs outside tenant tx, artifact type use_cases after approve', async () => {
    const handle = await startRun(ORG, 'transkript_zu_use_cases', {
      thema: 'Produkteinführung Logistik-Software Nordwind',
      fokus: 'Onboarding',
    });
    expect(handle.status).toBe('awaiting_approval');
    expect(fake.calls.length).toBeGreaterThanOrEqual(1);
    expect(fake.calls.every((c) => c.orgContextDuringCall === null)).toBe(true);

    const completed = await approve(ORG, handle.runId, APPROVER);
    expect(completed.status).toBe('completed');

    const arts = await withTenant(ORG, (tx) =>
      tx.artifact.findMany({ where: { runId: handle.runId } }),
    );
    expect(arts).toHaveLength(1);
    expect(arts[0].type).toBe('use_cases');

    const blob = getBlobProvider();
    const data = await blob.get(arts[0].blobKey);
    expect(data).not.toBeNull();
    const text = new TextDecoder().decode(data!.bytes);
    expect(text).toMatch(/Prioritized use cases|Priorisierte Use Cases/i);
    expect(text).toMatch(/Sources:|Quellen:/);

    // Criteria set for type must be registered and pass a good doc.
    const obs = {
      sourceKey: 'deliverable' as const,
      externalRef: arts[0].id,
      type: 'use_cases',
      content: text,
      metadata: {},
      createdAt: new Date(),
    };
    const results = useCasesCriteria.criteria.map((c) => c.check(obs));
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('guardrail reason is the generative always-on message', async () => {
    const handle = await startRun(ORG, 'transkript_zu_use_cases', {
      thema: 'ops',
      rolle: 'lead',
    });
    const approval = await withTenant(ORG, (tx) =>
      tx.approval.findFirst({ where: { runId: handle.runId } }),
    );
    expect(approval?.reason).toContain('Generative deliverable');
    expect(USE_CASES_GUARDRAIL_REASON.length).toBeGreaterThan(10);
  });
});
