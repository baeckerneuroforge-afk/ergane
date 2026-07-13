// P3-C: transkript_zu_briefing generative deliverable
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, startRun } from '../src/lib/skills';
import { __setChatProviderForTests, type ChatProvider } from '../src/lib/ai';
import { ingestDocument } from '../src/lib/rag';
import { getBlobProvider } from '../src/lib/storage/blob';
import { briefingCriteria } from '../src/lib/loop/criteria/briefing';

const ORG = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
const APPROVER = 'brief_lead';
const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'documents',
  'chunks',
  'skill_runs',
  'skill_steps',
  'approvals',
  'artifacts',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const TRANSCRIPT = [
  'Kickoff Nordwind Logistik: warehouse pilot Onboarding Lager Teams,',
  'Automatisierung Wareneingang, Dashboard. Drei Wünsche und Timeline.',
].join(' ');

const fake: ChatProvider = {
  name: 'brief-fake',
  async complete() {
    return [
      '## Executive summary',
      'Nordwind wants a warehouse pilot with onboarding and automation.',
      '',
      '## Key decisions needed',
      '- Choose pilot site',
      '- Confirm API access',
      '',
      '## Risks',
      '- Legacy ERP limits',
      '',
      '## Recommended next conversation',
      '- Who owns the pilot?',
    ].join('\n');
  },
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  __setChatProviderForTests(fake);
  await reset();
});
afterAll(async () => {
  __setChatProviderForTests(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  __setChatProviderForTests(fake);
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_brief', name: 'Brief Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
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

describe('transkript_zu_briefing', () => {
  it('produces briefing artifact after approval', async () => {
    const handle = await startRun(ORG, 'transkript_zu_briefing', {
      thema: 'Logistik Pilot Nordwind',
    });
    expect(handle.status).toBe('awaiting_approval');
    const done = await approve(ORG, handle.runId, APPROVER);
    expect(done.status).toBe('completed');

    const arts = await withTenant(ORG, (tx) =>
      tx.artifact.findMany({ where: { runId: handle.runId } }),
    );
    expect(arts).toHaveLength(1);
    expect(arts[0]!.type).toBe('briefing');

    const blob = await getBlobProvider().get(arts[0]!.blobKey);
    const text = new TextDecoder().decode(blob!.bytes);
    expect(text).toMatch(/Executive summary/i);
    expect(text).toMatch(/Sources:|Quellen:/);

    const results = briefingCriteria.criteria.map((c) =>
      c.check({
        sourceKey: 'deliverable',
        externalRef: arts[0]!.id,
        type: 'briefing',
        content: text,
        metadata: {},
        createdAt: new Date(),
      }),
    );
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
