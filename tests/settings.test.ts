// =============================================================================
// SETTINGS / MEMBERSHIP-ROLE GATE (Phase 6)
//
// Covers the ONE new backend function of the settings branch:
// setMembershipRole. Same harness as policy.test.ts — runs as `app_user`,
// owner connection only to reset, no network.
//
// What it proves:
//   1. Admin-only: member and lead cannot change roles (same gate as every
//      other settings mutation — the policies functions share requireAdmin).
//   2. Tenant-scoped: an admin cannot touch another tenant's memberships —
//      neither as actor in a foreign org nor by naming a foreign userId.
//   3. Last-admin guard: the only admin-tier member cannot be demoted; after
//      promoting a second admin the demotion works.
//   4. Every change writes audit 'membership.role_changed' with { old, new };
//      a no-op change writes nothing.
//   5. 'owner' is not assignable through this function.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { setMembershipRole } from '../src/lib/policies';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const ADMIN_A = 'a_admin';
const LEAD_A = 'a_lead';
const MEMBER_A = 'a_member';

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.createMany({
      data: [
        { orgId, userId: orgId === ORG_A ? ADMIN_A : 'b_admin', role: 'admin' },
        { orgId, userId: orgId === ORG_A ? LEAD_A : 'b_lead', role: 'lead' },
        { orgId, userId: orgId === ORG_A ? MEMBER_A : 'b_member', role: 'member' },
      ],
    });
  });
}

async function roleOf(orgId: string, userId: string) {
  const m = await withTenant(orgId, (tx) =>
    tx.membership.findUniqueOrThrow({ where: { orgId_userId: { orgId, userId } } }),
  );
  return m.role;
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
  await seedOrg(ORG_A, 'org_set_a', 'Settings Org A');
  await seedOrg(ORG_B, 'org_set_b', 'Settings Org B');
});

describe('setMembershipRole (the one new settings mutation)', () => {
  it('admin-only: member and lead cannot change roles', async () => {
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: MEMBER_A, userId: LEAD_A, role: 'member' }),
    ).rejects.toThrow(/admin required/);
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: LEAD_A, userId: MEMBER_A, role: 'lead' }),
    ).rejects.toThrow(/admin required/);

    // Nothing changed.
    expect(await roleOf(ORG_A, LEAD_A)).toBe('lead');
    expect(await roleOf(ORG_A, MEMBER_A)).toBe('member');
  });

  it('admin changes a role; audit membership.role_changed carries { old, new }', async () => {
    const saved = await setMembershipRole({
      orgId: ORG_A, actorUserId: ADMIN_A, userId: MEMBER_A, role: 'lead',
    });
    expect(saved.role).toBe('lead');
    expect(await roleOf(ORG_A, MEMBER_A)).toBe('lead');

    const entry = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findFirstOrThrow({ where: { action: 'membership.role_changed' } }),
    );
    expect(entry.actorId).toBe(ADMIN_A);
    expect(entry.actorType).toBe('human');
    expect(entry.target).toBe(`membership:${MEMBER_A}`);
    expect(entry.detail).toMatchObject({ userId: MEMBER_A, old: 'member', new: 'lead' });
  });

  it('a no-op change writes no audit entry', async () => {
    await setMembershipRole({
      orgId: ORG_A, actorUserId: ADMIN_A, userId: MEMBER_A, role: 'member',
    });
    const entries = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'membership.role_changed' } }),
    );
    expect(entries).toHaveLength(0);
  });

  it("tenant-scoped: B's admin is nobody in A; A's admin cannot reach B's members", async () => {
    // b_admin has no membership in A → the admin gate fails closed.
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: 'b_admin', userId: MEMBER_A, role: 'admin' }),
    ).rejects.toThrow(/admin required/);

    // A foreign userId is invisible under A's RLS context → "no membership".
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN_A, userId: 'b_member', role: 'lead' }),
    ).rejects.toThrow(/no membership/);

    // B is untouched.
    expect(await roleOf(ORG_B, 'b_member')).toBe('member');
    expect(await roleOf(ORG_A, MEMBER_A)).toBe('member');
  });

  it('last-admin guard: the only admin cannot be demoted; with a second admin it works', async () => {
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN_A, userId: ADMIN_A, role: 'member' }),
    ).rejects.toThrow(/last admin/);
    expect(await roleOf(ORG_A, ADMIN_A)).toBe('admin');

    // Promote a second admin — now the demotion is allowed.
    await setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN_A, userId: MEMBER_A, role: 'admin' });
    await setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN_A, userId: ADMIN_A, role: 'member' });
    expect(await roleOf(ORG_A, ADMIN_A)).toBe('member');
    expect(await roleOf(ORG_A, MEMBER_A)).toBe('admin');
  });

  it("'owner' is not assignable through this function", async () => {
    await expect(
      setMembershipRole({ orgId: ORG_A, actorUserId: ADMIN_A, userId: MEMBER_A, role: 'owner' }),
    ).rejects.toThrow(/role must be one of/);
  });
});
