// P2-D: Drive connector — verify, normalize, webhook, restricted doc ingest
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { upsertConnectorInstallation } from '../src/lib/connectors';
import { encryptConnectorToken } from '../src/lib/connectors/crypto';
import {
  computeDriveSignature,
  handleDriveWebhook,
  normalizeDriveFile,
  processDriveFileIngest,
  verifyDriveSignature,
} from '../src/lib/connectors/drive';
import { drainDeferredWork } from '../src/lib/slack/defer';
import { resolveIngestVisibility } from '../src/lib/rag/ingest';

const ORG = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const ADMIN = 'drive_admin';
const WORKSPACE = 'user:drive-test-1';
const SECRET = 'drive-webhook-test-secret';

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
  process.env.DRIVE_WEBHOOK_SECRET = SECRET;
  if (!process.env.SLACK_TOKEN_ENC_KEY && !process.env.CONNECTOR_TOKEN_ENC_KEY) {
    process.env.SLACK_TOKEN_ENC_KEY = Buffer.alloc(32, 11).toString('base64');
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  process.env.DRIVE_WEBHOOK_SECRET = SECRET;
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_drive', name: 'Drive Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
  });
  await upsertConnectorInstallation({
    orgId: ORG,
    actorUserId: ADMIN,
    provider: 'drive',
    externalId: WORKSPACE,
    accessTokenRef: encryptConnectorToken('ya29_test'),
  });
});

describe('normalize + visibility', () => {
  it('builds drive:file external_ref and source=doc', () => {
    const item = normalizeDriveFile({
      id: 'file123',
      name: 'Strategy.docx',
      text: 'Company strategy content for Q3.',
      mimeType: 'application/vnd.google-apps.document',
    });
    expect(item!.source).toBe('doc');
    expect(item!.externalRef).toBe('drive:file:file123');
    expect(resolveIngestVisibility('doc', 'open')).toBe('restricted');
  });
});

describe('verifyDriveSignature', () => {
  it('accepts HMAC; channel token alone must not authenticate content bodies', async () => {
    const body = '{"a":1}';
    const sig = computeDriveSignature(SECRET, body);
    expect(
      verifyDriveSignature({ signingSecret: SECRET, rawBody: body, signatureHeader: sig }),
    ).toBe(true);
    // Channel token still verifies at the crypto layer for empty pings…
    expect(
      verifyDriveSignature({
        signingSecret: SECRET,
        rawBody: '',
        signatureHeader: null,
        channelTokenHeader: SECRET,
      }),
    ).toBe(true);
    // …but the handler rejects content-bearing bodies with only a channel token.
    const evil = {
      workspaceId: WORKSPACE,
      file: { id: 'evil', name: 'Evil', text: 'injected payload text body' },
    };
    const res = await handleDriveWebhook(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-channel-token': SECRET,
        },
        body: JSON.stringify(evil),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('webhook', () => {
  function signed(bodyObj: unknown) {
    const raw = JSON.stringify(bodyObj);
    return new Request('http://localhost/api/connectors/drive/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-helix-drive-signature': computeDriveSignature(SECRET, raw),
      },
      body: raw,
    });
  }

  it('401 bad signature', async () => {
    const res = await handleDriveWebhook(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'x-helix-drive-signature': '00' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('403 unmapped workspace', async () => {
    const res = await handleDriveWebhook(
      signed({
        workspaceId: 'user:other',
        file: { id: 'f1', name: 'X', text: 'body' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('ingests file as restricted doc', async () => {
    const res = await handleDriveWebhook(
      signed({
        workspaceId: WORKSPACE,
        file: {
          id: 'doc-1',
          name: 'Runbook',
          text: 'Ops runbook content for onboarding.',
          modifiedTime: new Date().toISOString(),
        },
      }),
    );
    expect(res.status).toBe(200);
    await drainDeferredWork();
    const docs = await withTenant(ORG, (tx) =>
      tx.document.findMany({ where: { source: 'doc' } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].visibility).toBe('restricted');
    expect(docs[0].externalRef).toBe('drive:file:doc-1');
  });

  it('dedups external_ref on re-ingest', async () => {
    const file = { id: 'dup', name: 'A', text: 'version one text content here' };
    await processDriveFileIngest(ORG, file);
    await processDriveFileIngest(ORG, { ...file, name: 'A v2', text: 'version two text content here' });
    const docs = await withTenant(ORG, (tx) =>
      tx.document.findMany({ where: { externalRef: 'drive:file:dup' } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('A v2');
  });
});
