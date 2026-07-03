// =============================================================================
// RETENTION-CRON GATE
//
//   1. retention_org_ids(): liefert NUR Tenants mit gesetzter Frist — als
//      app_user, ohne Tenant-Kontext (SECURITY DEFINER, Migration 0016).
//   2. runRetentionSweep(): löscht pro Tenant nur zu alte Nachrichten,
//      tenant-scoped (Audit pro Org); Tenants ohne Frist bleiben unberührt.
//   3. Cron-Route: fail-closed — ohne CRON_SECRET 503, falscher Header 401,
//      korrekter Header 200 mit Zählwerten (keine Tenant-Daten).
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { runRetentionSweep, setChatRetention } from '../src/lib/lifecycle';
import { GET as cronGet } from '../src/app/api/cron/retention/route';

const ORG_A = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const ORG_B = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
const ADMIN = 'rc_admin';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'chat_messages', 'org_settings',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_rc_a', 'Cron A'],
    [ORG_B, 'org_rc_b', 'Cron B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
    });
  }
}

async function addMessage(orgId: string, content: string, ageDays = 0) {
  await withTenant(orgId, (tx) =>
    tx.chatMessage.create({ data: { orgId, role: 'user', content, actorId: 'x' } }),
  );
  if (ageDays > 0) {
    await admin.$executeRawUnsafe(
      `UPDATE "chat_messages" SET "created_at" = now() - interval '${ageDays} days'
       WHERE "content" = '${content}'`,
    );
  }
}

async function messages(orgId: string): Promise<string[]> {
  const rows = await withTenant(orgId, (tx) => tx.chatMessage.findMany());
  return rows.map((m) => m.content);
}

beforeAll(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  delete process.env.CRON_SECRET;
  await reset();
  await seed();
});

describe('retention_org_ids()', () => {
  it('returns only tenants WITH a retention setting — without tenant context', async () => {
    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 30 });
    // ORG_B: Settings-Zeile ohne Frist (upsert über setChatRetention(null)).
    await setChatRetention({ orgId: ORG_B, actorUserId: ADMIN, retentionDays: null });

    const rows = await prisma.$queryRaw<Array<{ org_id: string }>>`
      SELECT retention_org_ids() AS org_id
    `;
    expect(rows.map((r) => r.org_id)).toEqual([ORG_A]);
  });
});

describe('runRetentionSweep()', () => {
  it('purges old messages per tenant, leaves fresh ones and no-limit tenants alone', async () => {
    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 30 });
    await addMessage(ORG_A, 'a-alt', 45);
    await addMessage(ORG_A, 'a-frisch', 1);
    await addMessage(ORG_B, 'b-uralt', 400); // keine Frist ⇒ bleibt

    const result = await runRetentionSweep();
    expect(result).toEqual({ orgs: 1, deleted: 1, failed: 0 });

    expect(await messages(ORG_A)).toEqual(['a-frisch']);
    expect(await messages(ORG_B)).toEqual(['b-uralt']);

    // Audit im betroffenen Tenant, via auto-retention.
    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'chat.purged' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ deletedCount: 1, via: 'auto-retention' });
  });

  it('is a quiet no-op when no tenant has a retention setting', async () => {
    await addMessage(ORG_A, 'bleibt', 400);
    expect(await runRetentionSweep()).toEqual({ orgs: 0, deleted: 0, failed: 0 });
    expect(await messages(ORG_A)).toEqual(['bleibt']);
  });
});

describe('GET /api/cron/retention', () => {
  const req = (auth?: string) =>
    new Request('http://localhost/api/cron/retention', {
      headers: auth ? { authorization: auth } : {},
    });

  it('503 without CRON_SECRET configured (fail-closed)', async () => {
    const res = await cronGet(req('Bearer whatever'));
    expect(res.status).toBe(503);
  });

  it('401 with missing or wrong bearer', async () => {
    process.env.CRON_SECRET = 'test-secret';
    expect((await cronGet(req())).status).toBe(401);
    expect((await cronGet(req('Bearer falsch'))).status).toBe(401);
  });

  it('200 with correct bearer; body carries only counters', async () => {
    process.env.CRON_SECRET = 'test-secret';
    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 30 });
    await addMessage(ORG_A, 'alt', 45);

    const res = await cronGet(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, orgs: 1, deleted: 1, failed: 0 });
  });
});
