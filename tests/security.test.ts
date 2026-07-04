// =============================================================================
// SECURITY VIEW — honest checks + admin gate
//
// The Security view claims to make the system's guarantees legible AND
// verifiable. These tests hold it to that:
//
//   1. Admin gate: a member is rejected (loadSecurityView → "admin required");
//      an admin gets the properties. Same gate as every governance action.
//   2. The LIVE checks return the REAL schema structure — and could go red:
//        - tenant isolation reports 4/4 tenant tables with RLS+FORCE (pass);
//        - audit immutability reports append-only (no UPDATE/DELETE policy,
//          both guard triggers) (pass).
//      We also prove the fail path is reachable: a check run against a table
//      that is NOT append-only would flip to 'fail' (asserted via the evidence
//      shape and status contract, not by mutating the real schema).
//   3. NO sensitive data leaks: the evidence carries only aggregated schema
//      structure (table names, flags, policy/trigger names, counts) — never a
//      tenant row, a customer record, or another org's id.
//   4. The test/architecture-secured properties are labelled as such — NOT as a
//      live status (no fake green).
//
// Harness matches the rest of the suite: runs as least-privileged `app_user`
// (DATABASE_URL), owner connection only to reset, no network.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import {
  checkTenantIsolation,
  checkAuditImmutability,
  checkMoneyFailsafe,
  checkAntiHallucination,
  checkEuDataResidency,
  collectSecurityProperties,
  loadSecurityView,
  TENANT_TABLES,
} from '../src/lib/security/checks';

const ORG_A = 'ecec1111-ecec-4ece-8ece-ecececececec';
const ORG_B = 'ecec2222-ecec-4ece-8ece-ecececececec';
const ALL_TABLES = ['organizations', 'memberships', 'knowledge_items', 'audit_log'];

const ADMIN_A = 'sec_admin_a';
const MEMBER_A = 'sec_member_a';

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string, adminId: string, memberId: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.createMany({
      data: [
        { orgId, userId: adminId, role: 'admin' },
        { orgId, userId: memberId, role: 'member' },
      ],
    });
  });
}

beforeAll(async () => {
  // Precondition: refuse to run unless connected as the powerless app_user.
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
  await seedOrg(ORG_A, 'org_sec_a', 'Security Org A', ADMIN_A, MEMBER_A);
  await seedOrg(ORG_B, 'org_sec_b', 'Security Org B', 'b_admin', 'b_member');
});

describe('admin gate (loadSecurityView)', () => {
  it('a member is rejected with "admin required"', async () => {
    await expect(
      loadSecurityView({ orgId: ORG_A, actorUserId: MEMBER_A }),
    ).rejects.toThrow(/admin required/);
  });

  it('a user with no membership in the org is rejected', async () => {
    await expect(
      loadSecurityView({ orgId: ORG_A, actorUserId: 'nobody' }),
    ).rejects.toThrow(/admin required/);
  });

  it("an admin from another org cannot read this org's view", async () => {
    // b_admin is admin in ORG_B, but has no admin membership visible in ORG_A.
    await expect(
      loadSecurityView({ orgId: ORG_A, actorUserId: 'b_admin' }),
    ).rejects.toThrow(/admin required/);
  });

  it('an admin gets the full set of properties', async () => {
    const props = await loadSecurityView({ orgId: ORG_A, actorUserId: ADMIN_A });
    expect(props.map((p) => p.key)).toEqual([
      'tenantIsolation',
      'auditImmutability',
      'moneyFailsafe',
      'antiHallucination',
      'euDataResidency',
    ]);
  });
});

describe('live check: tenant isolation (RLS + FORCE)', () => {
  it('reports every tenant table protected (4/4, pass) — the real live count', async () => {
    const p = await checkTenantIsolation();
    expect(p.basis).toBe('live');
    expect(p.status).toBe('pass');
    expect(p.evidence.kind).toBe('rlsCount');
    if (p.evidence.kind === 'rlsCount') {
      expect(p.evidence.total).toBe(TENANT_TABLES.length);
      expect(p.evidence.secured).toBe(TENANT_TABLES.length);
      expect(p.evidence.secured).toBe(4);
      // The tables named are exactly the tenant tables — no other table names.
      expect(p.evidence.tables.sort()).toEqual([...TENANT_TABLES].sort());
    }
  });

  it('the set it checks matches the isolation gate (tests/isolation.test.ts)', () => {
    // If a new tenant table is added to one place but not the other, this fails.
    expect([...TENANT_TABLES].sort()).toEqual(
      ['audit_log', 'knowledge_items', 'memberships', 'organizations'].sort(),
    );
  });
});

describe('live check: audit immutability (append-only)', () => {
  it('reports append-only (no UPDATE/DELETE policy, both guard triggers) — pass', async () => {
    const p = await checkAuditImmutability();
    expect(p.basis).toBe('live');
    expect(p.status).toBe('pass');
    expect(p.evidence.kind).toBe('auditPolicies');
    if (p.evidence.kind === 'auditPolicies') {
      expect(p.evidence.hasUpdateOrDelete).toBe(false);
      // Only SELECT + INSERT policies exist on audit_log.
      expect(p.evidence.policies.sort()).toEqual(['INSERT', 'SELECT']);
      // Both defense-in-depth triggers present.
      expect(p.evidence.triggers).toContain('audit_log_no_update');
      expect(p.evidence.triggers).toContain('audit_log_no_delete');
    }
  });
});

describe('the fail path is real — a live check can come back not-green', () => {
  it("tenant isolation flips to 'fail' when FORCE is dropped, then recovers", async () => {
    // Actually regress the schema (as owner), prove the tile goes red, and
    // restore it in finally. This is the honesty guarantee proven live: if FORCE
    // is ever lost in production, the check reports 'fail', not a fake green.
    expect((await checkTenantIsolation()).status).toBe('pass');
    try {
      await admin.$executeRawUnsafe('ALTER TABLE "organizations" NO FORCE ROW LEVEL SECURITY');
      const regressed = await checkTenantIsolation();
      expect(regressed.status).toBe('fail');
      if (regressed.evidence.kind === 'rlsCount') {
        expect(regressed.evidence.secured).toBe(regressed.evidence.total - 1);
      }
    } finally {
      await admin.$executeRawUnsafe('ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY');
    }
    expect((await checkTenantIsolation()).status).toBe('pass');
  });

  it("audit immutability flips to 'fail' when a permissive UPDATE policy appears, then recovers", async () => {
    expect((await checkAuditImmutability()).status).toBe('pass');
    try {
      await admin.$executeRawUnsafe(
        'CREATE POLICY sec_probe_update ON "audit_log" FOR UPDATE USING (true)',
      );
      const regressed = await checkAuditImmutability();
      expect(regressed.status).toBe('fail');
      if (regressed.evidence.kind === 'auditPolicies') {
        expect(regressed.evidence.hasUpdateOrDelete).toBe(true);
      }
    } finally {
      await admin.$executeRawUnsafe('DROP POLICY sec_probe_update ON "audit_log"');
    }
    expect((await checkAuditImmutability()).status).toBe('pass');
  });

  it('a RESTRICTIVE deny policy STRENGTHENS append-only and must NOT flip to fail', async () => {
    // A restrictive UPDATE deny (USING false) only tightens immutability. The
    // check must recognize it is not a grant and stay green — otherwise we would
    // punish someone for hardening the table (a wrong-fail).
    expect((await checkAuditImmutability()).status).toBe('pass');
    try {
      await admin.$executeRawUnsafe(
        'CREATE POLICY sec_probe_restrict ON "audit_log" AS RESTRICTIVE FOR UPDATE USING (false)',
      );
      const still = await checkAuditImmutability();
      expect(still.status).toBe('pass');
      if (still.evidence.kind === 'auditPolicies') {
        expect(still.evidence.hasUpdateOrDelete).toBe(false);
      }
    } finally {
      await admin.$executeRawUnsafe('DROP POLICY sec_probe_restrict ON "audit_log"');
    }
    expect((await checkAuditImmutability()).status).toBe('pass');
  });
});

describe('no sensitive data in the evidence', () => {
  it('carries only aggregated schema structure — no org ids, no tenant rows', async () => {
    const props = await collectSecurityProperties();
    const serialized = JSON.stringify(props);

    // No tenant org ids leak into the payload.
    expect(serialized).not.toContain(ORG_A);
    expect(serialized).not.toContain(ORG_B);
    expect(serialized).not.toContain(ADMIN_A);
    expect(serialized).not.toContain(MEMBER_A);

    // The evidence is only the whitelisted structural shapes.
    const allowedKinds = new Set([
      'rlsCount',
      'auditPolicies',
      'moneySkills',
      'threshold',
      'statement',
      'error',
    ]);
    for (const p of props) {
      expect(allowedKinds.has(p.evidence.kind)).toBe(true);
    }

    // The only strings the live checks expose are schema-level identifiers
    // (table names, policy commands, trigger names) — assert they are on an
    // expected, non-sensitive allowlist.
    const tenant = props.find((p) => p.key === 'tenantIsolation');
    if (tenant?.evidence.kind === 'rlsCount') {
      for (const name of tenant.evidence.tables) {
        expect(ALL_TABLES).toContain(name);
      }
    }
  });
});

describe('honesty of the basis labels (no fake live status)', () => {
  it('tenant isolation and audit immutability are LIVE', async () => {
    expect((await checkTenantIsolation()).basis).toBe('live');
    expect((await checkAuditImmutability()).basis).toBe('live');
  });

  it('money failsafe is TEST-secured, not a live status', () => {
    const p = checkMoneyFailsafe();
    expect(p.basis).toBe('test');
    // Never a live status — must not masquerade as a momentary DB check.
    expect(p.basis).not.toBe('live');
    expect(p.evidence.kind).toBe('moneySkills');
    if (p.evidence.kind === 'moneySkills') {
      // At least one money-touching skill exists — the count is real, not zero.
      expect(p.evidence.total).toBeGreaterThanOrEqual(1);
    }
  });

  it('anti-hallucination is ARCHITECTURE-secured and reports the real threshold', () => {
    const p = checkAntiHallucination();
    expect(p.basis).toBe('architecture');
    expect(p.evidence.kind).toBe('threshold');
    if (p.evidence.kind === 'threshold') {
      // The fake embedder used in tests has a 0.05 threshold; whatever provider
      // is active, the value is surfaced (not hardcoded) and in (0,1].
      expect(p.evidence.value).toBeGreaterThan(0);
      expect(p.evidence.value).toBeLessThanOrEqual(1);
    }
  });

  it('EU data residency is a STATEMENT, never presented as a live check', () => {
    const p = checkEuDataResidency();
    expect(p.basis).toBe('architecture');
    expect(p.evidence.kind).toBe('statement');
    // Explicitly NOT 'live' — this must never masquerade as a momentary status.
    expect(p.basis).not.toBe('live');
  });
});
