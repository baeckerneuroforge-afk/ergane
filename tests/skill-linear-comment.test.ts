// P3-A: linear_kommentar write skill — gate + fake provider path
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, startRun } from '../src/lib/skills';
import { upsertConnectorInstallation } from '../src/lib/connectors';
import { encryptConnectorToken } from '../src/lib/connectors/crypto';
import {
  getFakeToolWriteProvider,
  getToolWriteProvider,
  describeLinearComment,
} from '../src/lib/effects';
import { LINEAR_COMMENT_GUARDRAIL_REASON } from '../src/lib/skills/catalog/linear_kommentar';
import { LINEAR_OAUTH_SCOPES, buildLinearAuthorizeUrl, makeLinearOAuthState } from '../src/lib/connectors/linear';

const ORG = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const APPROVER = 'lin_write_admin';

const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'skill_runs',
  'skill_steps',
  'approvals',
  'connector_installations',
  'documents',
  'chunks',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  if (!process.env.SLACK_TOKEN_ENC_KEY && !process.env.CONNECTOR_TOKEN_ENC_KEY) {
    process.env.SLACK_TOKEN_ENC_KEY = Buffer.alloc(32, 3).toString('base64');
  }
  delete process.env.HELIX_LINEAR_WRITE;
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  delete process.env.HELIX_LINEAR_WRITE;
  getFakeToolWriteProvider().reset();
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_lin_write', name: 'Lin Write' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'admin' } });
  });
  await upsertConnectorInstallation({
    orgId: ORG,
    actorUserId: APPROVER,
    provider: 'linear',
    externalId: 'lin_ws_write',
    accessTokenRef: encryptConnectorToken('lin_pat_test_token'),
  });
});

afterEach(() => {
  getFakeToolWriteProvider().reset();
  delete process.env.HELIX_LINEAR_WRITE;
});

describe('Linear OAuth scopes for write path', () => {
  it('requests comments:create (and write) so product tokens can post comments', () => {
    expect(LINEAR_OAUTH_SCOPES).toContain('read');
    expect(LINEAR_OAUTH_SCOPES).toContain('comments:create');
    expect(LINEAR_OAUTH_SCOPES).toContain('write');
  });

  it('authorize URL includes write scopes (shipped path)', () => {
    process.env.LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID || 'lin_client_test';
    process.env.LINEAR_OAUTH_STATE_SECRET =
      process.env.LINEAR_OAUTH_STATE_SECRET || 'linear-oauth-state-secret-for-tests';
    const url = buildLinearAuthorizeUrl(
      makeLinearOAuthState('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      'https://example.com/api/connectors/linear/oauth/callback',
    );
    expect(url).toMatch(/scope=/);
    // URL-encoded comma-separated scopes
    const scopeParam = new URL(url).searchParams.get('scope') ?? '';
    expect(scopeParam).toMatch(/read/);
    expect(scopeParam).toMatch(/comments:create|write/);
  });
});

describe('getToolWriteProvider selection', () => {
  it('uses fake in non-production without HELIX_LINEAR_WRITE', () => {
    const p = getToolWriteProvider();
    expect(p.name).toBe('fake-tool-write');
  });

  it('throws in production without HELIX_LINEAR_WRITE', () => {
    const env = process.env as { NODE_ENV?: string };
    const prev = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      expect(() => getToolWriteProvider()).toThrow(/HELIX_LINEAR_WRITE/);
    } finally {
      env.NODE_ENV = prev;
    }
  });
});

describe('linear_kommentar engine path', () => {
  it('pauses for approval, then posts via fake after approve', async () => {
    const issueId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const body = 'Helix note: follow up on pilot timeline.';
    const handle = await startRun(ORG, 'linear_kommentar', { issueId, body });
    expect(handle.status).toBe('awaiting_approval');
    // Effect must NOT run before approval
    expect(getFakeToolWriteProvider().comments).toHaveLength(0);

    const approval = await withTenant(ORG, (tx) =>
      tx.approval.findFirst({ where: { runId: handle.runId } }),
    );
    expect(approval?.reason).toContain('External write');
    expect(LINEAR_COMMENT_GUARDRAIL_REASON.length).toBeGreaterThan(10);

    const done = await approve(ORG, handle.runId, APPROVER);
    expect(done.status).toBe('completed');

    const comments = getFakeToolWriteProvider().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.issueId).toBe(issueId);
    expect(comments[0]!.body).toBe(body);
    expect(comments[0]!.accessToken).toBe('lin_pat_test_token');

    const steps = await withTenant(ORG, (tx) =>
      tx.skillStep.findMany({ where: { runId: handle.runId }, orderBy: { idx: 'asc' } }),
    );
    const send = steps.find((s) => s.name === 'kommentar_senden');
    const detail = send?.detail as { gesendet?: boolean; simulated?: boolean };
    expect(detail?.gesendet).toBe(true);
    expect(detail?.simulated).toBe(true);
  });

  it('describeLinearComment is pure and readable', () => {
    const d = describeLinearComment('iss-1', 'Hello world from helix');
    expect(d).toMatch(/iss-1/);
    expect(d).toMatch(/Hello world/);
  });

  it('policy never cannot skip approval for requiresHumanApproval skills', async () => {
    await withTenant(ORG, async (tx) => {
      await tx.approvalPolicy.create({
        data: {
          orgId: ORG,
          skillKey: 'linear_kommentar',
          mode: 'never',
        },
      });
    });
    const handle = await startRun(ORG, 'linear_kommentar', {
      issueId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      body: 'must still pause',
    });
    expect(handle.status).toBe('awaiting_approval');
    expect(getFakeToolWriteProvider().comments).toHaveLength(0);
  });

  it('simulation never posts', async () => {
    const handle = await startRun(
      ORG,
      'linear_kommentar',
      { issueId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', body: 'dry' },
      { mode: 'simulation' },
    );
    // Simulation may complete without real effect
    expect(['completed', 'awaiting_approval']).toContain(handle.status);
    if (handle.status === 'awaiting_approval') {
      await approve(ORG, handle.runId, APPROVER);
    }
    expect(getFakeToolWriteProvider().comments).toHaveLength(0);
  });
});
