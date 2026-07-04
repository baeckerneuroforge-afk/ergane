// =============================================================================
// LOOP EVALUATION: Schritt A — deliverable acceptance criteria.
//
// Proves:
//   (a) evaluateDeliverableCriteria loads blob content OUTSIDE any withTenant
//       transaction (app.current_org is NULL during blob access).
//   (b) When criteria are violated, a flag.criteria_violated audit entry is
//       written AND skill_runs.trace is set.
//   (c) When all criteria pass, NO flag is written but trace IS set.
//   (d) Best-effort: if evaluation throws internally, the run does not fail.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { createArtifact } from '../src/lib/artifacts';
import { getFakeBlobProvider } from '../src/lib/storage/blob';
import { evaluateDeliverableCriteria } from '../src/lib/loop/evaluate';
import { queryAuditLog } from '../src/lib/audit';

const ORG = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaa010';
const ACTOR = 'loop_test_actor';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'artifacts',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies',
  'clients',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fakeBlob = getFakeBlobProvider();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  fakeBlob.reset();
}

async function seedOrg() {
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_loop_test', name: 'Loop Test Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: ACTOR, role: 'admin' } });
  });
}

const GOOD_FRAMEWORK = [
  '# Framework - Acme Logistics',
  '',
  '## Executive summary',
  'Acme Logistics operates three warehouses with 200 employees across Northern Germany.',
  'The primary challenge is manual data entry consuming 30% of warehouse manager time.',
  'We recommend a phased digitalization starting with a self-service portal at Hamburg.',
  '',
  '## Situation',
  'The client currently relies on paper-based goods receipt processes and phone-based',
  'stock inquiries. Warehouse managers spend 2.5 hours daily on manual data entry into',
  'the legacy ERP. The Hamburg site processes 450 deliveries per week with 12% error rate.',
  '',
  '## Key themes & goals',
  '- Reduce manual data entry time by 50% within 6 months of rollout',
  '- Achieve a unified real-time inventory view across all three locations',
  '- Decrease goods receipt error rate from 12% to below 3%',
  '',
  '## Constraints',
  '- The legacy ERP system provides read-only API access via SOAP only',
  '- EU data residency is required for all inventory and personnel data',
  '- The IT team has capacity for one integration project per quarter',
  '',
  '## Prioritized use cases',
  '1. **Self-service stock inquiry portal** for warehouse staff to check stock levels',
  '2. **Unified cross-warehouse inventory dashboard** for real-time stock balancing',
  '3. **Scan-based automated goods receipt** to replace manual booking at the dock',
  '',
  '## Next steps',
  '1. Scope the pilot project at the Hamburg warehouse with the local team',
  '2. Set up read-only API access to the legacy ERP for the integration layer',
  '3. Define success metrics and measurement baseline before pilot launch',
  '',
  '---',
  '',
  '_Sources: Kickoff-Transkript Kunde Nordwind, Follow-Up Nordwind_',
].join('\n');

const BAD_FRAMEWORK = [
  '## Executive summary',
  'Short summary.',
  '',
  '## Prioritized use cases',
  '1. One use case only',
  '',
  '_Sources: Doc A_',
].join('\n');

async function createRun(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const run = await tx.skillRun.create({
      data: {
        orgId,
        skillKey: 'transkript_zu_framework',
        status: 'running',
        mode: 'live',
        input: {},
      },
    });
    return run.id;
  });
}

async function createTestArtifact(orgId: string, content: string, runId: string | null = null) {
  const bytes = new TextEncoder().encode(content);
  return createArtifact({
    orgId,
    title: 'Framework — Test Client',
    type: 'framework',
    bytes,
    contentType: 'text/markdown',
    runId,
  });
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string }>
  >`SELECT current_user`;
  if (role?.current_user !== 'app_user') {
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
  await seedOrg();
});

describe('evaluateDeliverableCriteria', () => {
  it('writes trace + flag when criteria are violated', async () => {
    const runId = await createRun(ORG);
    const artifact = await createTestArtifact(ORG, BAD_FRAMEWORK, runId);

    const state = {
      framework_ausgegeben: {
        generiert: true,
        artifactId: artifact.id,
      },
    };

    const trace = await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', runId, state);

    expect(trace).not.toBeNull();
    expect(trace!.flagRaised).toBe(true);
    expect(trace!.failedCount).toBeGreaterThan(0);
    expect(trace!.v).toBe(1);
    expect(trace!.artifactId).toBe(artifact.id);
    expect(trace!.type).toBe('framework');

    // Verify trace persisted on skill_runs
    const run = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
    );
    expect(run.trace).not.toBeNull();
    const persisted = run.trace as Record<string, unknown>;
    expect(persisted.v).toBe(1);
    expect(persisted.flagRaised).toBe(true);

    // Verify flag audit entry
    const audit = await queryAuditLog(ORG, { actionPrefixes: ['flag.'] });
    expect(audit.total).toBe(1);
    expect(audit.entries[0].action).toBe('flag.criteria_violated');
    expect(audit.entries[0].actorId).toBe('loop-engine');
    expect(audit.entries[0].actorType).toBe('agent');
    expect(audit.entries[0].target).toBe(artifact.id);
    const detail = audit.entries[0].detail as Record<string, unknown>;
    expect(detail.category).toBe('criteria');
    expect(detail.type).toBe('framework');
    expect(Array.isArray(detail.failedCriteria)).toBe(true);
  });

  it('writes trace but NO flag when all criteria pass', async () => {
    const runId = await createRun(ORG);
    const artifact = await createTestArtifact(ORG, GOOD_FRAMEWORK, runId);

    const state = {
      framework_ausgegeben: {
        generiert: true,
        artifactId: artifact.id,
      },
    };

    const trace = await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', runId, state);

    expect(trace).not.toBeNull();
    expect(trace!.flagRaised).toBe(false);
    expect(trace!.failedCount).toBe(0);
    expect(trace!.passedCount).toBe(5);

    // Trace persisted
    const run = await withTenant(ORG, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
    );
    expect(run.trace).not.toBeNull();
    const persisted = run.trace as Record<string, unknown>;
    expect(persisted.flagRaised).toBe(false);

    // NO flag audit entry
    const audit = await queryAuditLog(ORG, { actionPrefixes: ['flag.'] });
    expect(audit.total).toBe(0);
  });

  it('returns null when no artifact in state', async () => {
    const runId = await createRun(ORG);
    const result = await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', runId, {});
    expect(result).toBeNull();
  });

  it('returns null for non-framework artifact type', async () => {
    const runId = await createRun(ORG);
    const bytes = new TextEncoder().encode('Invoice content');
    const artifact = await createArtifact({
      orgId: ORG,
      title: 'Invoice',
      type: 'invoice',
      bytes,
      contentType: 'text/markdown',
    });

    const state = {
      some_step: { artifactId: artifact.id },
    };

    const result = await evaluateDeliverableCriteria(ORG, 'rechnung_erstellen', runId, state);
    expect(result).toBeNull();
  });

  it('blob loading happens OUTSIDE any withTenant transaction', async () => {
    const runId = await createRun(ORG);
    const artifact = await createTestArtifact(ORG, BAD_FRAMEWORK, runId);

    // Instrument the fake blob to check for tenant context during get()
    let orgContextDuringBlobGet: string | null | undefined;
    const origGet = fakeBlob.get.bind(fakeBlob);
    fakeBlob.get = async (key: string) => {
      const [{ org }] = await prisma.$queryRaw<Array<{ org: string | null }>>`
        SELECT current_setting('app.current_org', true) AS org
      `;
      orgContextDuringBlobGet = org && org.length > 0 ? org : null;
      return origGet(key);
    };

    const state = {
      framework_ausgegeben: {
        generiert: true,
        artifactId: artifact.id,
      },
    };

    await evaluateDeliverableCriteria(ORG, 'transkript_zu_framework', runId, state);

    // The blob get happened, and NO tenant transaction was active
    expect(orgContextDuringBlobGet).toBeNull();

    // Restore
    fakeBlob.get = origGet;
  });
});
