// =============================================================================
// AUTO-RETENTION GATE (Phase 15)
//
//   1. setChatRetention: admin-only, validated, audited with {old,new}.
//   2. enforceChatRetention: NULL ⇒ no-op; N days ⇒ deletes only older
//      messages, only in the OWN tenant; audits only when something was
//      actually deleted (no noise).
//   3. RLS regression on org_settings (ENABLE + FORCE, no-context 0 rows).
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  enforceChatRetention,
  getChatRetention,
  setChatRetention,
} from '../src/lib/lifecycle';

const ORG_A = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const ORG_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const ADMIN = 'rt_admin';
const MEMBER = 'rt_member';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'chat_messages', 'org_settings',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_rt_a', 'Retention A'],
    [ORG_B, 'org_rt_b', 'Retention B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
      await tx.membership.create({ data: { orgId, userId: MEMBER, role: 'member' } });
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

describe('setChatRetention / getChatRetention', () => {
  it('admin sets, reads back, audit carries {old,new}; null switches off', async () => {
    expect(await getChatRetention(ORG_A)).toBeNull();

    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 30 });
    expect(await getChatRetention(ORG_A)).toBe(30);

    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: null });
    expect(await getChatRetention(ORG_A)).toBeNull();

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'policy.changed', target: 'org_settings:chat_retention_days' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]!.detail).toMatchObject({ old: null, new: 30 });
    expect(audit[1]!.detail).toMatchObject({ old: 30, new: null });
  });

  it('rejects non-admins and invalid values', async () => {
    await expect(
      setChatRetention({ orgId: ORG_A, actorUserId: MEMBER, retentionDays: 30 }),
    ).rejects.toThrow(/admin required/);
    await expect(
      setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 0 }),
    ).rejects.toThrow();
    await expect(
      setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 1.5 }),
    ).rejects.toThrow();
  });
});

describe('enforceChatRetention', () => {
  it('NULL retention ⇒ no-op, nothing deleted, no audit noise', async () => {
    await addMessage(ORG_A, 'uralt', 400);
    expect(await enforceChatRetention(ORG_A)).toBe(0);
    expect(await withTenant(ORG_A, (tx) => tx.chatMessage.count())).toBe(1);
    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.count({ where: { action: 'chat.purged' } }),
    );
    expect(audit).toBe(0);
  });

  it('deletes only messages older than the window — own tenant only, audited once', async () => {
    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 30 });
    await addMessage(ORG_A, 'a-alt', 31);
    await addMessage(ORG_A, 'a-neu', 0);
    await addMessage(ORG_B, 'b-alt', 31); // B has NO retention configured

    const removed = await enforceChatRetention(ORG_A);
    expect(removed).toBe(1);

    const aLeft = await withTenant(ORG_A, (tx) => tx.chatMessage.findMany());
    expect(aLeft.map((m) => m.content)).toEqual(['a-neu']);
    expect(await withTenant(ORG_B, (tx) => tx.chatMessage.count())).toBe(1); // untouched

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'chat.purged' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorType).toBe('agent');
    expect(audit[0]!.detail).toMatchObject({ via: 'auto-retention', deletedCount: 1 });

    // Second run: window is clean ⇒ no-op, no second audit entry.
    expect(await enforceChatRetention(ORG_A)).toBe(0);
    expect(
      await withTenant(ORG_A, (tx) => tx.auditLog.count({ where: { action: 'chat.purged' } })),
    ).toBe(1);
  });
});

describe('org_settings RLS regression', () => {
  it('RLS is ENABLEd AND FORCEd; no-context and cross-tenant reads see nothing', async () => {
    const [row] = await admin.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'org_settings' AND relkind = 'r'`;
    expect(row!.relrowsecurity).toBe(true);
    expect(row!.relforcerowsecurity).toBe(true);

    await setChatRetention({ orgId: ORG_A, actorUserId: ADMIN, retentionDays: 7 });
    expect(await prisma.orgSettings.findMany()).toHaveLength(0); // no context
    const fromB = await withTenant(ORG_B, (tx) => tx.orgSettings.findMany());
    expect(fromB).toHaveLength(0); // cross-tenant
  });
});
