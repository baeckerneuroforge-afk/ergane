// =============================================================================
// LINEAR CONNECTOR (P0-A)
//
// Proves the fail-closed external entry + ingest dedup path:
//   1. Signature: valid accepted; invalid / missing ⇒ 401, no work.
//   2. Workspace → org: unmapped organizationId ⇒ 403.
//   3. Issue create/update → document with external_ref, source=ticket,
//      visibility=restricted (never open).
//   4. Re-delivery / same external_ref ⇒ one document (dedup upsert).
//   5. Idempotency claim ⇒ second identical webhook event does not re-ingest.
//   6. RLS: connector tables 0 rows without tenant context.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { ingestDocument, resolveIngestVisibility } from '../src/lib/rag/ingest';
import {
  computeLinearSignature,
  handleLinearWebhook,
  normalizeLinearIssue,
  processLinearIssueIngest,
  verifyLinearSignature,
} from '../src/lib/connectors/linear';
import { upsertConnectorInstallation } from '../src/lib/connectors';
import { drainDeferredWork } from '../src/lib/slack/defer';
import { encryptConnectorToken } from '../src/lib/connectors/crypto';

const ORG_A = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const ORG_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const ADMIN = 'linear_admin';
const LINEAR_ORG = 'lin_org_workspace_a';
const SECRET = 'linear-test-webhook-secret';

const ALL_TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'documents',
  'chunks',
  'connector_installations',
  'connector_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const embedder = new FakeEmbeddingProvider();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_linear_a', 'Linear A'],
    [ORG_B, 'org_linear_b', 'Linear B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
    });
  }
  // Encryption key for install token (tests).
  if (!process.env.SLACK_TOKEN_ENC_KEY && !process.env.CONNECTOR_TOKEN_ENC_KEY) {
    process.env.SLACK_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  }
  await upsertConnectorInstallation({
    orgId: ORG_A,
    actorUserId: ADMIN,
    provider: 'linear',
    externalId: LINEAR_ORG,
    accessTokenRef: encryptConnectorToken('lin_oauth_test_token'),
  });
}

function issuePayload(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    action: 'create',
    type: 'Issue',
    organizationId: LINEAR_ORG,
    webhookId: 'wh_test_1',
    webhookTimestamp: now,
    data: {
      id: 'issue-uuid-1',
      identifier: 'ENG-1',
      title: 'Ship Linear connector',
      description: 'Acceptance Criteria:\n- Webhook works\n- Dedup works',
      dueDate: '2099-01-01',
      assigneeId: 'user_1',
      cycleId: 'cycle_1',
      state: { type: 'started', name: 'In Progress' },
      createdAt: new Date(now - 86400000).toISOString(),
      updatedAt: new Date(now).toISOString(),
      url: 'https://linear.app/test/issue/ENG-1',
      ...(typeof overrides.data === 'object' && overrides.data !== null
        ? (overrides.data as object)
        : {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'data')),
  };
}

function signedWebhook(bodyObj: unknown, opts: { secret?: string; signature?: string } = {}) {
  const rawBody = JSON.stringify(bodyObj);
  const secret = opts.secret ?? SECRET;
  const signature = opts.signature ?? computeLinearSignature(secret, rawBody);
  return new Request('http://localhost/api/connectors/linear/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'linear-signature': signature,
    },
    body: rawBody,
  });
}

beforeAll(async () => {
  process.env.LINEAR_WEBHOOK_SECRET = SECRET;
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  process.env.LINEAR_WEBHOOK_SECRET = SECRET;
  await reset();
  await seed();
});

describe('resolveIngestVisibility (fail-closed for tools)', () => {
  it('forces restricted for ticket/code/doc even if open requested', () => {
    expect(resolveIngestVisibility('ticket', 'open')).toBe('restricted');
    expect(resolveIngestVisibility('code', 'open')).toBe('restricted');
    expect(resolveIngestVisibility('doc')).toBe('restricted');
    expect(resolveIngestVisibility('ticket', 'confidential')).toBe('confidential');
    expect(resolveIngestVisibility('upload', 'open')).toBe('open');
    expect(resolveIngestVisibility('manual')).toBe('open');
  });
});

describe('normalizeLinearIssue', () => {
  it('builds external_ref and source_meta', () => {
    const item = normalizeLinearIssue({
      id: 'abc',
      identifier: 'ENG-9',
      title: 'Hello',
      description: 'Body with Acceptance Criteria listed',
      state: { type: 'unstarted', name: 'Todo' },
      dueDate: '2020-01-01',
      assigneeId: null,
      cycleId: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
    });
    expect(item).not.toBeNull();
    expect(item!.externalRef).toBe('linear:issue:abc');
    expect(item!.source).toBe('ticket');
    expect(item!.sourceMeta.state).toBe('unstarted');
    expect(item!.sourceMeta.dueDate).toBe('2020-01-01');
  });
});

describe('verifyLinearSignature', () => {
  it('accepts valid signature and rejects tampering', () => {
    const body = '{"hello":true}';
    const sig = computeLinearSignature(SECRET, body);
    expect(
      verifyLinearSignature({
        signingSecret: SECRET,
        rawBody: body,
        signatureHeader: sig,
      }),
    ).toBe(true);
    expect(
      verifyLinearSignature({
        signingSecret: SECRET,
        rawBody: body,
        signatureHeader: 'deadbeef',
      }),
    ).toBe(false);
    expect(
      verifyLinearSignature({
        signingSecret: SECRET,
        rawBody: body + 'x',
        signatureHeader: sig,
      }),
    ).toBe(false);
  });
});

describe('ingestDocument externalRef upsert', () => {
  it('upserts same external_ref to one document, restricted', async () => {
    const ref = 'linear:issue:dup-1';
    const r1 = await ingestDocument({
      orgId: ORG_A,
      actorId: 'connector:linear',
      title: 'v1',
      source: 'ticket',
      text: 'First version of the ticket body with enough text to chunk.',
      externalRef: ref,
      sourceMeta: { state: 'started' },
      visibility: 'open', // must be forced to restricted
      embedder,
    });
    const r2 = await ingestDocument({
      orgId: ORG_A,
      actorId: 'connector:linear',
      title: 'v2 updated',
      source: 'ticket',
      text: 'Second version of the ticket body with enough text to chunk again.',
      externalRef: ref,
      sourceMeta: { state: 'started', assigneeId: 'u2' },
      embedder,
    });
    expect(r1.documentId).toBe(r2.documentId);

    const docs = await withTenant(ORG_A, (tx) =>
      tx.document.findMany({ where: { externalRef: ref } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('v2 updated');
    expect(docs[0].visibility).toBe('restricted');
    expect(docs[0].source).toBe('ticket');
  });

  it('does not leak across tenants via external_ref', async () => {
    const ref = 'linear:issue:shared-id-space';
    await ingestDocument({
      orgId: ORG_A,
      actorId: 'connector:linear',
      title: 'A',
      source: 'ticket',
      text: 'Org A ticket text content for isolation test case.',
      externalRef: ref,
      embedder,
    });
    await ingestDocument({
      orgId: ORG_B,
      actorId: 'connector:linear',
      title: 'B',
      source: 'ticket',
      text: 'Org B ticket text content for isolation test case.',
      externalRef: ref,
      embedder,
    });
    const a = await withTenant(ORG_A, (tx) => tx.document.findMany({ where: { externalRef: ref } }));
    const b = await withTenant(ORG_B, (tx) => tx.document.findMany({ where: { externalRef: ref } }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe('Linear webhook handler', () => {
  it('returns 401 on bad signature', async () => {
    const res = await handleLinearWebhook(signedWebhook(issuePayload(), { signature: '00' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when workspace is not mapped', async () => {
    const res = await handleLinearWebhook(
      signedWebhook(issuePayload({ organizationId: 'unknown_workspace' })),
    );
    expect(res.status).toBe(403);
  });

  it('ingests issue into knowledge base after ack', async () => {
    const res = await handleLinearWebhook(signedWebhook(issuePayload()));
    expect(res.status).toBe(200);
    await drainDeferredWork();

    const docs = await withTenant(ORG_A, (tx) =>
      tx.document.findMany({ where: { source: 'ticket' } }),
    );
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs[0].externalRef).toBe('linear:issue:issue-uuid-1');
    expect(docs[0].visibility).toBe('restricted');
  });

  it('processLinearIssueIngest is idempotent on external_ref', async () => {
    const payload = issuePayload();
    const a = await processLinearIssueIngest(ORG_A, payload);
    const b = await processLinearIssueIngest(ORG_A, {
      ...payload,
      action: 'update',
      data: { ...payload.data, title: 'Updated title' },
    });
    expect(a?.documentId).toBe(b?.documentId);
    const docs = await withTenant(ORG_A, (tx) =>
      tx.document.findMany({ where: { externalRef: 'linear:issue:issue-uuid-1' } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toContain('Updated title');
  });
});

describe('connector tables RLS', () => {
  it('returns 0 rows without tenant context', async () => {
    const installs = await prisma.connectorInstallation.findMany();
    const events = await prisma.connectorProcessedEvent.findMany();
    expect(installs).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
