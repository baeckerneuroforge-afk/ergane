// =============================================================================
// LIVE ISOLATION DEMO — proof that the demo screen shows real behavior.
//
// Two things are guarded here:
//   1. the VISIBILITY gate (isDemoOrg) — the /demo/isolation route is enabled
//      for demo orgs only; a real customer org gets a 404. Pure, no DB.
//   2. the CROSS-TENANT PROOF (attemptCrossTenantAccess) — runs the exact code
//      path behind the button, as the least-privileged app_user, against the
//      real database. Org A reading Org B's row id must come back EMPTY, while
//      the same query against Org A's own row returns it. If isolation ever
//      broke, this test would fail — which is the whole point of the demo.
//
// Like tests/isolation.test.ts, this runs as `app_user` (DATABASE_URL), so it
// exercises real RLS + FORCE enforcement, not a privileged shortcut.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import {
  DEMO_ORG_A,
  DEMO_ORG_B,
  attemptCrossTenantAccess,
  demoAllowlist,
  ensureDemoData,
  isDemoOrg,
} from '../src/lib/demo/isolation';

beforeAll(async () => {
  // The proof only means something if it runs as the least-privileged app_user
  // (a superuser or a BYPASSRLS role would defeat RLS silently). Fail loudly
  // otherwise — identical guard to the canonical isolation gate.
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Refusing to run: connected as "${role?.current_user}" (super=${role?.rolsuper}, ` +
        `bypassrls=${role?.rolbypassrls}). The demo proof MUST run as app_user.`,
    );
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------
describe('demo isolation — visibility gate (route enabled for demo orgs only)', () => {
  it('enables the demo for the built-in demo orgs and the "demo" slug', () => {
    const base = demoAllowlist(''); // no env override → {demo, demo_org_a, demo_org_b}
    expect(isDemoOrg({ clerkOrgId: DEMO_ORG_A.clerkOrgId, orgSlug: null }, base)).toBe(true);
    expect(isDemoOrg({ clerkOrgId: DEMO_ORG_B.clerkOrgId, orgSlug: null }, base)).toBe(true);
    // Any org whose slug is "demo" also counts (case-insensitive).
    expect(isDemoOrg({ clerkOrgId: 'org_2anything', orgSlug: 'Demo' }, base)).toBe(true);
  });

  it('hides the demo from a real customer org (opaque Clerk id + normal slug → 404)', () => {
    const base = demoAllowlist('');
    expect(isDemoOrg({ clerkOrgId: 'org_2rK9realCustomer', orgSlug: 'acme-gmbh' }, base)).toBe(false);
    expect(isDemoOrg({ clerkOrgId: 'org_2rK9realCustomer', orgSlug: null }, base)).toBe(false);
  });

  it('respects the DEMO_ORG_SLUGS allowlist override, exactly', () => {
    const allow = demoAllowlist('pilot-acme, showcase');
    expect(isDemoOrg({ clerkOrgId: 'org_x', orgSlug: 'pilot-acme' }, allow)).toBe(true);
    expect(isDemoOrg({ clerkOrgId: 'org_x', orgSlug: 'showcase' }, allow)).toBe(true);
    expect(isDemoOrg({ clerkOrgId: 'org_x', orgSlug: 'not-listed' }, allow)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('demo isolation — the REAL cross-tenant proof (app_user + RLS FORCE)', () => {
  it('Org A reading Org B’s record → 0 rows; Org A reading its OWN record → 1 row', async () => {
    // This is exactly what the button runs. Every field asserted below is derived
    // from the actual query results inside attemptCrossTenantAccess().
    const proof = await attemptCrossTenantAccess();

    // THE ATTEMPT: Org A, in its own tenant context, asked for Org B's record by
    // id and got nothing. Not an app-level check — RLS returned zero rows.
    expect(proof.blocked).toBe(true);
    expect(proof.crossTenantRead.rowCount).toBe(0);
    expect(proof.crossTenantRead.row).toBeNull();

    // CONTROL: the same query shape against Org A's OWN record returns it — so the
    // empty result above is isolation, not a broken/empty query.
    expect(proof.controlOk).toBe(true);
    expect(proof.controlRead.rowCount).toBe(1);
    expect(proof.controlRead.row?.title).toBe(DEMO_ORG_A.itemTitle);

    // The target is a real, readable row — in its OWN context.
    expect(proof.victimSelfRead.found).toBe(true);
    expect(proof.attacker.orgId).toBe(DEMO_ORG_A.orgId);
    expect(proof.victim.orgId).toBe(DEMO_ORG_B.orgId);
    expect(proof.victim.itemId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('the block is the DATABASE, not the wrapper: a raw withTenant cross-read is also empty', async () => {
    // Re-prove independently of attemptCrossTenantAccess(): use withTenant()
    // directly to read Org B's real item id from Org A's context.
    await ensureDemoData();

    const bItem = await withTenant(DEMO_ORG_B.orgId, (tx) =>
      tx.knowledgeItem.findFirstOrThrow({ where: { title: DEMO_ORG_B.itemTitle } }),
    );
    expect(bItem.orgId).toBe(DEMO_ORG_B.orgId);

    const leaked = await withTenant(DEMO_ORG_A.orgId, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: bItem.id } }),
    );
    expect(leaked).toBeNull();

    // And Org A can read its own row by id → the id-lookup path itself works.
    const aItem = await withTenant(DEMO_ORG_A.orgId, (tx) =>
      tx.knowledgeItem.findFirstOrThrow({ where: { title: DEMO_ORG_A.itemTitle } }),
    );
    const own = await withTenant(DEMO_ORG_A.orgId, (tx) =>
      tx.knowledgeItem.findUnique({ where: { id: aItem.id } }),
    );
    expect(own?.id).toBe(aItem.id);
  });
});
