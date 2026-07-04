// =============================================================================
// TENANT ISOLATION GATE
//
// The most important artifact in the repo. These tests FAIL if tenant isolation
// breaks. They run as the application role `app_user` (DATABASE_URL) — exactly
// how the app connects — so they exercise the real RLS enforcement, not a
// privileged shortcut. A privileged "admin" connection (DIRECT_DATABASE_URL, the
// owner/superuser) is used ONLY to reset state and to prove the append-only
// TRIGGER independently of RLS.
//
// Tests 1–5 are the canonical gate. The "regression guards" block hardens it
// against silent weakening (dropped FORCE, weakened WITH CHECK, lost privileges,
// GUC leakage) — added after an adversarial security review.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
// Single source of truth for the tenant-table set — shared with the Security
// view's live RLS check, so the two can never drift.
import { TENANT_TABLES } from '../src/lib/security/checks';

// Two tenants. Fixed UUIDs make assertions deterministic.
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

// Privileged connection — superuser bypasses RLS; used ONLY for reset + the
// independent trigger proof.
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  // Superuser → bypasses RLS. TRUNCATE does not fire the append-only row trigger,
  // and app_user could never do this (no TRUNCATE privilege) — which is the point.
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TENANT_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

// Seed one full set of tenant rows THROUGH the tenant boundary. This also proves
// the happy-path WITH CHECK accepts matching org_ids for every tenant table.
async function seedTenant(orgId: string, clerkOrgId: string, name: string, userId: string, itemTitle: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.knowledgeItem.create({ data: { orgId, title: itemTitle, body: `belongs to ${name}` } });
    await tx.membership.create({ data: { orgId, userId, role: 'admin' } });
    await tx.auditLog.create({
      data: { orgId, actorId: userId, actorType: 'human', action: 'seed', target: null },
    });
  });
}

beforeAll(async () => {
  // Precondition guarding the ENTIRE suite: if app_user were ever misconfigured
  // (superuser / bypassrls), Tests 1–4 could pass while isolation is a lie. Fail
  // loudly here instead.
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Refusing to run: connected as "${role?.current_user}" (super=${role?.rolsuper}, bypassrls=${role?.rolbypassrls}). ` +
        'The gate MUST run as the least-privileged app_user — otherwise it proves nothing.',
    );
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
  await seedTenant(ORG_A, 'org_a', 'Org A', 'user_a', 'A-secret');
  await seedTenant(ORG_B, 'org_b', 'Org B', 'user_b', 'B-secret');
});

// -----------------------------------------------------------------------------
describe('tenant isolation gate (enforced by Postgres RLS + FORCE)', () => {
  it('Test 1: withTenant(A) sees ONLY A’s items, never B’s', async () => {
    const items = await withTenant(ORG_A, (tx) => tx.knowledgeItem.findMany());

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('A-secret');
    expect(items.every((i) => i.orgId === ORG_A)).toBe(true);
    expect(items.some((i) => i.title === 'B-secret')).toBe(false);
  });

  it('Test 2: tenant A cannot read or update B’s item by id', async () => {
    const bItem = await withTenant(ORG_B, (tx) => tx.knowledgeItem.findFirstOrThrow());

    const leaked = await withTenant(ORG_A, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: bItem.id } }),
    );
    expect(leaked).toBeNull();

    const updated = await withTenant(ORG_A, (tx) =>
      tx.knowledgeItem.updateMany({ where: { id: bItem.id }, data: { title: 'hacked-by-A' } }),
    );
    expect(updated.count).toBe(0);

    const stillThere = await withTenant(ORG_B, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: bItem.id } }),
    );
    expect(stillThere?.title).toBe('B-secret');
  });

  it('Test 3: INSERT with a foreign org_id is rejected by WITH CHECK', async () => {
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.knowledgeItem.create({ data: { orgId: ORG_B, title: 'smuggled', body: 'x' } }),
      ),
    ).rejects.toThrow();

    const bItems = await withTenant(ORG_B, (tx) => tx.knowledgeItem.findMany());
    expect(bItems).toHaveLength(1);
    expect(bItems[0]?.title).toBe('B-secret');
  });

  it('Test 4: querying ANY tenant table WITHOUT a context returns NO rows', async () => {
    // Bare client, no withTenant → no set_config → current_setting is NULL/'' →
    // NULLIF(...) → NULL → RLS fails closed on every tenant table.
    expect(await prisma.organization.findMany()).toHaveLength(0);
    expect(await prisma.membership.findMany()).toHaveLength(0);
    expect(await prisma.knowledgeItem.findMany()).toHaveLength(0);
    expect(await prisma.auditLog.findMany()).toHaveLength(0);
  });

  it('Test 5: app_user CANNOT bypass RLS (not superuser, no bypassrls, not owner)', async () => {
    // (a) Role configuration: app_user is powerless by construction.
    const roleRows = await prisma.$queryRaw<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(roleRows[0]?.current_user).toBe('app_user');
    expect(roleRows[0]?.rolsuper).toBe(false);
    expect(roleRows[0]?.rolbypassrls).toBe(false);

    // (b) app_user owns none of the tenant tables → FORCE RLS always applies.
    const ownerRows = await prisma.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
      SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('organizations', 'knowledge_items', 'memberships', 'audit_log')`;
    expect(ownerRows).toHaveLength(4);
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

// -----------------------------------------------------------------------------
describe('isolation regression guards', () => {
  it('every tenant table has RLS ENABLE *and* FORCE', async () => {
    // Catches a dropped FORCE (which app_user-only tests would otherwise miss,
    // since FORCE only affects the table owner) and a dropped ENABLE.
    const rows = await prisma.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('organizations', 'memberships', 'knowledge_items', 'audit_log')`;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} ENABLE RLS`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} FORCE RLS`).toBe(true);
    }
  });

  it('positive cross-tenant READ isolation for memberships and audit_log', async () => {
    const aMembers = await withTenant(ORG_A, (tx) => tx.membership.findMany());
    expect(aMembers).toHaveLength(1);
    expect(aMembers[0]?.userId).toBe('user_a');
    expect(aMembers.every((m) => m.orgId === ORG_A)).toBe(true);

    const aAudit = await withTenant(ORG_A, (tx) => tx.auditLog.findMany());
    expect(aAudit.length).toBeGreaterThanOrEqual(1);
    expect(aAudit.every((a) => a.orgId === ORG_A)).toBe(true);

    // ...and B's rows are completely invisible from A.
    const bMember = await withTenant(ORG_B, (tx) => tx.membership.findFirstOrThrow());
    const leakedMember = await withTenant(ORG_A, (tx) =>
      tx.membership.findUnique({ where: { id: bMember.id } }),
    );
    expect(leakedMember).toBeNull();
  });

  it('organizations is self-row isolated (a tenant sees/edits only its own org)', async () => {
    const visible = await withTenant(ORG_A, (tx) => tx.organization.findMany());
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(ORG_A);

    const leaked = await withTenant(ORG_A, (tx) =>
      tx.organization.findUnique({ where: { id: ORG_B } }),
    );
    expect(leaked).toBeNull();

    const renamed = await withTenant(ORG_A, (tx) =>
      tx.organization.updateMany({ where: { id: ORG_B }, data: { name: 'hacked' } }),
    );
    expect(renamed.count).toBe(0);

    const bUntouched = await withTenant(ORG_B, (tx) =>
      tx.organization.findUniqueOrThrow({ where: { id: ORG_B } }),
    );
    expect(bUntouched.name).toBe('Org B');
  });

  it('UPDATE cannot MOVE a row to another tenant (WITH CHECK on UPDATE)', async () => {
    const aItem = await withTenant(ORG_A, (tx) => tx.knowledgeItem.findFirstOrThrow());

    // Re-tagging A's own row to B must be rejected by WITH CHECK.
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.knowledgeItem.update({ where: { id: aItem.id }, data: { orgId: ORG_B } }),
      ),
    ).rejects.toThrow();

    // The row is untouched and still A's.
    const after = await withTenant(ORG_A, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: aItem.id } }),
    );
    expect(after?.orgId).toBe(ORG_A);

    // Same guarantee for memberships.
    const aMember = await withTenant(ORG_A, (tx) => tx.membership.findFirstOrThrow());
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.membership.update({ where: { id: aMember.id }, data: { orgId: ORG_B } }),
      ),
    ).rejects.toThrow();
  });

  it('audit_log is append-only via the TRIGGER, independently of RLS', async () => {
    // The admin connection is a superuser → it BYPASSES RLS. So if an UPDATE or
    // DELETE on audit_log still fails, it can only be the trigger doing it. This
    // proves the trigger guard is intact even if the RLS guard were removed.
    await expect(
      admin.$executeRawUnsafe(`UPDATE "audit_log" SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/i);
    await expect(admin.$executeRawUnsafe(`DELETE FROM "audit_log"`)).rejects.toThrow(/append-only/i);

    // And app_user cannot even UPDATE audit_log (no privilege) → throws.
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.auditLog.updateMany({ where: { orgId: ORG_A }, data: { action: 'x' } }),
      ),
    ).rejects.toThrow();
  });

  it('app_user lacks escalation privileges (DELETE org / TRUNCATE / _prisma_migrations)', async () => {
    // The only thing stopping app_user from cascade-deleting tenants via the org
    // table is the missing DELETE privilege — assert it explicitly.
    await expect(prisma.organization.deleteMany({})).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE "knowledge_items"'),
    ).rejects.toThrow();
    await expect(
      prisma.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"'),
    ).rejects.toThrow();
  });

  it('the tenant GUC does not leak across transactions on a reused connection', async () => {
    // tests/setup.ts pins app_user to a single connection, so this bare query
    // runs on the SAME backend that just had app.current_org set. Zero rows
    // proves the transaction-local GUC was reset at COMMIT (no cross-request leak).
    await withTenant(ORG_A, (tx) => tx.knowledgeItem.findMany());
    const afterCommit = await prisma.knowledgeItem.findMany();
    expect(afterCommit).toHaveLength(0);
  });
});
