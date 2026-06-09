// =============================================================================
// TENANT ISOLATION GATE
//
// These tests are the most important artifact in the repo. They FAIL if tenant
// isolation breaks. They run as the application role `app_user` (DATABASE_URL) —
// exactly how the app connects — so they exercise the real RLS enforcement, not
// a privileged shortcut.
//
// A privileged "admin" connection (DIRECT_DATABASE_URL, the owner/superuser) is
// used ONLY to reset state between cases.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';

// Two tenants. Fixed UUIDs make assertions deterministic.
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

// Privileged connection — superuser bypasses RLS; used ONLY for test reset.
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  // Superuser → bypasses RLS. TRUNCATE does not fire the append-only row trigger,
  // and app_user could never do this (no TRUNCATE privilege) — which is the point.
  await admin.$executeRawUnsafe(
    'TRUNCATE "audit_log", "knowledge_items", "memberships", "organizations" RESTART IDENTITY CASCADE',
  );
}

beforeAll(async () => {
  await reset();
});

afterAll(async () => {
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();

  // organizations has no RLS (tenant root) → app_user may insert directly.
  await prisma.organization.createMany({
    data: [
      { id: ORG_A, clerkOrgId: 'org_a', name: 'Org A' },
      { id: ORG_B, clerkOrgId: 'org_b', name: 'Org B' },
    ],
  });

  // One knowledge item per tenant, inserted THROUGH the tenant boundary — this
  // also proves the happy-path WITH CHECK accepts a matching org_id.
  await withTenant(ORG_A, (tx) =>
    tx.knowledgeItem.create({ data: { orgId: ORG_A, title: 'A-secret', body: 'belongs to A' } }),
  );
  await withTenant(ORG_B, (tx) =>
    tx.knowledgeItem.create({ data: { orgId: ORG_B, title: 'B-secret', body: 'belongs to B' } }),
  );
});

describe('tenant isolation (enforced by Postgres RLS + FORCE)', () => {
  it('Test 1: withTenant(A) sees ONLY A’s items, never B’s', async () => {
    const items = await withTenant(ORG_A, (tx) => tx.knowledgeItem.findMany());

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('A-secret');
    expect(items.every((i) => i.orgId === ORG_A)).toBe(true);
    // and definitely nothing from B
    expect(items.some((i) => i.title === 'B-secret')).toBe(false);
  });

  it('Test 2: tenant A cannot read or update B’s item by id', async () => {
    const bItem = await withTenant(ORG_B, (tx) => tx.knowledgeItem.findFirstOrThrow());

    // Read B's row by id while in A's context → invisible.
    const leaked = await withTenant(ORG_A, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: bItem.id } }),
    );
    expect(leaked).toBeNull();

    // Update B's row by id while in A's context → affects 0 rows (RLS filtered).
    const updated = await withTenant(ORG_A, (tx) =>
      tx.knowledgeItem.updateMany({ where: { id: bItem.id }, data: { title: 'hacked-by-A' } }),
    );
    expect(updated.count).toBe(0);

    // B's row is untouched.
    const stillThere = await withTenant(ORG_B, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: bItem.id } }),
    );
    expect(stillThere?.title).toBe('B-secret');
  });

  it('Test 3: INSERT with a foreign org_id is rejected by WITH CHECK', async () => {
    // In A's context, try to smuggle a row tagged for B → must throw.
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.knowledgeItem.create({ data: { orgId: ORG_B, title: 'smuggled', body: 'x' } }),
      ),
    ).rejects.toThrow();

    // Nothing leaked into B.
    const bItems = await withTenant(ORG_B, (tx) => tx.knowledgeItem.findMany());
    expect(bItems).toHaveLength(1);
    expect(bItems[0]?.title).toBe('B-secret');
  });

  it('Test 4: querying a tenant table WITHOUT a context returns NO rows', async () => {
    // Bare client, no withTenant → no set_config → current_setting is NULL →
    // RLS fails closed. This is why app code must never use the bare client.
    const items = await prisma.knowledgeItem.findMany();
    const memberships = await prisma.membership.findMany();
    const audit = await prisma.auditLog.findMany();

    expect(items).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('Test 5: app_user CANNOT bypass RLS (not superuser, no bypassrls, not owner)', async () => {
    // (a) Role configuration: app_user is powerless by construction.
    const roleRows = await prisma.$queryRaw<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT current_user, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user`;
    expect(roleRows[0]?.current_user).toBe('app_user');
    expect(roleRows[0]?.rolsuper).toBe(false);
    expect(roleRows[0]?.rolbypassrls).toBe(false);

    // (b) app_user owns none of the tenant tables → FORCE RLS always applies.
    const ownerRows = await prisma.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
      SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('knowledge_items', 'memberships', 'audit_log')`;
    expect(ownerRows).toHaveLength(3);
    for (const row of ownerRows) {
      expect(row.tableowner).not.toBe('app_user');
    }

    // (c) app_user cannot turn RLS off (requires ownership) → throws.
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.$executeRawUnsafe('ALTER TABLE "knowledge_items" DISABLE ROW LEVEL SECURITY'),
      ),
    ).rejects.toThrow();

    // (d) append-only audit_log: app_user can insert but never delete → throws.
    await withTenant(ORG_A, (tx) =>
      tx.auditLog.create({
        data: { orgId: ORG_A, actorId: 'tester', actorType: 'human', action: 'probe', target: null },
      }),
    );
    await expect(
      withTenant(ORG_A, (tx) => tx.auditLog.deleteMany({ where: { orgId: ORG_A } })),
    ).rejects.toThrow();
  });
});
