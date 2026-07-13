// P2-A: GitHub connector — verify, normalize, webhook gates, ingest dedup
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { upsertConnectorInstallation } from '../src/lib/connectors';
import { encryptConnectorToken } from '../src/lib/connectors/crypto';
import {
  computeGitHubSignature,
  extractTicketRefs,
  handleGitHubWebhook,
  normalizeGitHubCommit,
  processGitHubItems,
  verifyGitHubSignature,
} from '../src/lib/connectors/github';
import { drainDeferredWork } from '../src/lib/slack/defer';
import { resolveIngestVisibility } from '../src/lib/rag/ingest';

const ORG = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const ADMIN = 'gh_admin';
const REPO_ID = 424242;
const SECRET = 'github-webhook-test-secret';

const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'documents',
  'chunks',
  'connector_installations',
  'connector_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  if (!process.env.SLACK_TOKEN_ENC_KEY && !process.env.CONNECTOR_TOKEN_ENC_KEY) {
    process.env.SLACK_TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_gh', name: 'GH Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
  });
  await upsertConnectorInstallation({
    orgId: ORG,
    actorUserId: ADMIN,
    provider: 'github',
    externalId: `repo:${REPO_ID}`,
    accessTokenRef: encryptConnectorToken('gho_test'),
  });
});

describe('normalize + ticket refs', () => {
  it('extracts ticket refs and sets hasTicketRef', () => {
    expect(extractTicketRefs('fix ENG-42 and ABC-9')).toEqual(['ENG-42', 'ABC-9']);
    const item = normalizeGitHubCommit(
      {
        id: 'abc123def',
        message: 'feat: ship connector\n\nno ticket',
        timestamp: '2024-01-01T00:00:00Z',
      },
      'acme/helix',
    );
    expect(item!.source).toBe('code');
    expect(item!.externalRef).toBe('github:commit:abc123def');
    expect(item!.sourceMeta.hasTicketRef).toBe(false);

    const withRef = normalizeGitHubCommit(
      { id: 'deadbeef', message: 'ENG-99: fix webhook' },
      'acme/helix',
    );
    expect(withRef!.sourceMeta.hasTicketRef).toBe(true);
  });

  it('code visibility is restricted', () => {
    expect(resolveIngestVisibility('code', 'open')).toBe('restricted');
  });
});

describe('verifyGitHubSignature', () => {
  it('accepts valid sha256 signature', () => {
    const body = '{"ok":true}';
    const sig = computeGitHubSignature(SECRET, body);
    expect(
      verifyGitHubSignature({ signingSecret: SECRET, rawBody: body, signatureHeader: sig }),
    ).toBe(true);
    expect(
      verifyGitHubSignature({
        signingSecret: SECRET,
        rawBody: body,
        signatureHeader: 'sha256=00',
      }),
    ).toBe(false);
  });
});

describe('webhook handler', () => {
  function pushBody() {
    return {
      repository: { id: REPO_ID, full_name: 'acme/helix' },
      commits: [
        {
          id: '1111111111111111111111111111111111111111',
          message: 'ENG-1: add github connector',
          timestamp: new Date().toISOString(),
          url: 'https://github.com/acme/helix/commit/1111',
        },
      ],
    };
  }

  function signed(bodyObj: unknown, sig?: string) {
    const raw = JSON.stringify(bodyObj);
    const signature = sig ?? computeGitHubSignature(SECRET, raw);
    return new Request('http://localhost/api/connectors/github/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-event': 'push',
        'x-github-delivery': `deliv-${Math.random()}`,
      },
      body: raw,
    });
  }

  it('401 on bad signature', async () => {
    const res = await handleGitHubWebhook(signed(pushBody(), 'sha256=dead'));
    expect(res.status).toBe(401);
  });

  it('403 when repo not mapped', async () => {
    const body = pushBody();
    (body.repository as { id: number }).id = 999;
    const res = await handleGitHubWebhook(signed(body));
    expect(res.status).toBe(403);
  });

  it('ingests commit as restricted code document', async () => {
    const res = await handleGitHubWebhook(signed(pushBody()));
    expect(res.status).toBe(200);
    await drainDeferredWork();
    const docs = await withTenant(ORG, (tx) =>
      tx.document.findMany({ where: { source: 'code' } }),
    );
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs[0].visibility).toBe('restricted');
    expect(docs[0].externalRef).toMatch(/^github:commit:/);
  });

  it('resolves OAuth-style user: external_id via sender', async () => {
    // Re-map install as OAuth does (user:id), not repo:id.
    await withTenant(ORG, async (tx) => {
      await tx.connectorInstallation.deleteMany({ where: { provider: 'github' } });
    });
    await upsertConnectorInstallation({
      orgId: ORG,
      actorUserId: ADMIN,
      provider: 'github',
      externalId: 'user:9001',
      accessTokenRef: encryptConnectorToken('gho_user'),
    });
    const body = {
      repository: { id: 1, full_name: 'acme/helix', owner: { id: 9001 } },
      sender: { id: 9001 },
      commits: [
        {
          id: '2222222222222222222222222222222222222222',
          message: 'ENG-9: from user oauth',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const raw = JSON.stringify(body);
    const res = await handleGitHubWebhook(
      new Request('http://localhost/api/connectors/github/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': computeGitHubSignature(SECRET, raw),
          'x-github-event': 'push',
          'x-github-delivery': 'user-oauth-deliv',
        },
        body: raw,
      }),
    );
    expect(res.status).toBe(200);
    await drainDeferredWork();
    const docs = await withTenant(ORG, (tx) =>
      tx.document.findMany({ where: { externalRef: 'github:commit:2222222222222222222222222222222222222222' } }),
    );
    expect(docs).toHaveLength(1);
  });

  it('processGitHubItems dedups by external_ref', async () => {
    const item = normalizeGitHubCommit(
      { id: 'samehash', message: 'ENG-2: once' },
      'acme/helix',
    )!;
    const a = await processGitHubItems(ORG, [item]);
    const b = await processGitHubItems(ORG, [{ ...item, title: 'updated title' }]);
    expect(a[0]).toBe(b[0]);
    const docs = await withTenant(ORG, (tx) =>
      tx.document.findMany({ where: { externalRef: 'github:commit:samehash' } }),
    );
    expect(docs).toHaveLength(1);
  });
});
