// =============================================================================
// Isolation demo — the REAL cross-tenant probe behind the "attempt cross-tenant
// access" button (src/app/demo/isolation).
//
// This module is deliberately framework-free (no Clerk, no React) so the exact
// same code path runs in the browser demo AND in the integration test
// (tests/demo-isolation.test.ts). Nothing here is simulated: the "blocked"
// verdict is DERIVED from an actual Prisma query that runs, in Org A's tenant
// context, against Org B's row id — and comes back empty because Postgres RLS +
// FORCE fails closed. If isolation ever broke, this function would return a row
// and the test (and the demo) would light up red.
//
// Safety: the probe only ever touches the two fixed demo tenants below. Their
// ids are hard-coded here, never taken from a request — so this route can never
// be pointed at a real customer's org. And even if it could, withTenant()/RLS
// would still return nothing.
// =============================================================================
import type { Tx } from '../tenant';
import { withTenant } from '../tenant';

/** One fixed demo tenant. */
export interface DemoOrgSpec {
  /** Internal tenant UUID — the value passed to withTenant(). */
  readonly orgId: string;
  /** Clerk org id this tenant mirrors (matches prisma/seed.ts). */
  readonly clerkOrgId: string;
  readonly name: string;
  /** The single knowledge item this tenant owns (stable title = idempotent). */
  readonly itemTitle: string;
  readonly itemBody: string;
}

// Two demo tenants. UUIDs + Clerk ids match prisma/seed.ts, so `pnpm db:seed`
// and this demo describe the SAME two orgs. These are the ONLY ids this module
// ever reads or writes.
export const DEMO_ORG_A: DemoOrgSpec = {
  orgId: '11111111-1111-4111-8111-111111111111',
  clerkOrgId: 'demo_org_a',
  name: 'Demo Org A',
  itemTitle: 'Org A — Client contracts (Q3)',
  itemBody: 'Confidential to Demo Org A. Only Demo Org A may ever read this record.',
};

export const DEMO_ORG_B: DemoOrgSpec = {
  orgId: '22222222-2222-4222-8222-222222222222',
  clerkOrgId: 'demo_org_b',
  name: 'Demo Org B',
  itemTitle: 'Org B — Client contracts (Q3)',
  itemBody: 'Confidential to Demo Org B. Only Demo Org B may ever read this record.',
};

export const DEMO_ORGS: readonly DemoOrgSpec[] = [DEMO_ORG_A, DEMO_ORG_B];

// -----------------------------------------------------------------------------
// Visibility gate — WHO may see the demo route (never WHAT it proves).
// -----------------------------------------------------------------------------

/** The verified-session facts the gate is allowed to look at. */
export interface DemoOrgContext {
  clerkOrgId: string;
  orgSlug: string | null;
}

/** Nordwind seed org (scripts/seed-demo.ts) — same allowlist as isolation demos. */
export const NORDWIND_DEMO_CLERK_ORG_ID = 'demo_org_nordwind';

const BUILTIN_DEMO_KEYS = [
  DEMO_ORG_A.clerkOrgId,
  DEMO_ORG_B.clerkOrgId,
  NORDWIND_DEMO_CLERK_ORG_ID,
];

/**
 * Build the demo-org allowlist: the default demo slug + built-in demo
 * Clerk ids (isolation A/B + Nordwind seed), plus anything in DEMO_ORG_SLUGS
 * (comma/space separated). Lets a founder flag their real Clerk demo org
 * (e.g. slug "demo") without a code change, while a genuine customer org
 * never matches.
 */
export function demoAllowlist(env: string | undefined = process.env.DEMO_ORG_SLUGS): Set<string> {
  const extra = (env ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(['demo', 'nordwind', ...BUILTIN_DEMO_KEYS, ...extra]);
}

/**
 * Is the CURRENT tenant a designated demo org? The isolation demo is enabled
 * ONLY for these; a real customer org gets a 404. The decision is based purely
 * on the verified session's org slug / Clerk id (never on a request parameter),
 * matched against demoAllowlist(). This gates VISIBILITY only — the proof below
 * never touches the viewer's own data.
 */
export function isDemoOrg(ctx: DemoOrgContext, allowlist: Set<string> = demoAllowlist()): boolean {
  return [ctx.clerkOrgId, ctx.orgSlug]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toLowerCase())
    .some((candidate) => allowlist.has(candidate));
}

// -----------------------------------------------------------------------------
// Demo data — idempotent, RLS-conformant, read-only after the first run.
// -----------------------------------------------------------------------------

export interface DemoItem {
  id: string;
  title: string;
  body: string;
}

export interface DemoTenantState {
  orgId: string;
  clerkOrgId: string;
  name: string;
  item: DemoItem;
}

function toDemoItem(item: { id: string; title: string; body: string }): DemoItem {
  return { id: item.id, title: item.title, body: item.body };
}

/**
 * Ensure ONE demo tenant exists with exactly one knowledge item, and return its
 * current state (with the item's real id). Every write goes through
 * withTenant(): the org row is created in its own tenant context (organizations
 * has a self-row RLS policy keyed on id), and the item under the same context so
 * WITH CHECK (org_id = current_org) accepts it. Existing rows are reused, never
 * rewritten — so after the first call this is a pure read.
 */
async function ensureDemoTenant(spec: DemoOrgSpec): Promise<DemoTenantState> {
  return withTenant(spec.orgId, async (tx: Tx) => {
    const org = await tx.organization.findUnique({ where: { id: spec.orgId } });
    if (!org) {
      await tx.organization.create({
        data: { id: spec.orgId, clerkOrgId: spec.clerkOrgId, name: spec.name },
      });
    }

    let item = await tx.knowledgeItem.findFirst({ where: { title: spec.itemTitle } });
    if (!item) {
      item = await tx.knowledgeItem.create({
        data: { orgId: spec.orgId, title: spec.itemTitle, body: spec.itemBody },
      });
    }

    return {
      orgId: spec.orgId,
      clerkOrgId: spec.clerkOrgId,
      name: spec.name,
      item: toDemoItem(item),
    };
  });
}

/** Idempotently ensure both demo tenants exist; return their current state. */
export async function ensureDemoData(): Promise<{ a: DemoTenantState; b: DemoTenantState }> {
  const a = await ensureDemoTenant(DEMO_ORG_A);
  const b = await ensureDemoTenant(DEMO_ORG_B);
  return { a, b };
}

// -----------------------------------------------------------------------------
// The proof.
// -----------------------------------------------------------------------------

export interface IsolationProof {
  attacker: { orgId: string; name: string };
  victim: { orgId: string; name: string; itemId: string; itemTitle: string };
  /**
   * The victim's item read IN THE VICTIM'S OWN tenant context. Proves the target
   * id points at a real, readable row — so the empty cross-tenant read below is
   * isolation, not a missing/typo'd id.
   */
  victimSelfRead: { found: boolean; title: string | null };
  /** THE ATTEMPT: Org A's context reads Org B's item id. RLS must return nothing. */
  crossTenantRead: { rowCount: number; row: DemoItem | null };
  /** CONTROL: Org A's context reads Org A's OWN item id. Proves the query works. */
  controlRead: { rowCount: number; row: DemoItem | null };
  /** Derived from the ACTUAL query results — never hard-coded. */
  blocked: boolean;
  controlOk: boolean;
}

/**
 * Run the real cross-tenant read attempt and return what actually happened.
 *
 * Three queries, all through the sanctioned withTenant() boundary:
 *   0. Org B reads Org B's item     → found   (the target is real)
 *   1. Org A reads Org B's item id  → EMPTY   (RLS + FORCE blocks it)   ← the moment
 *   2. Org A reads Org A's item id  → found   (same query shape works)
 *
 * There is no application-level "if org !== owner" check anywhere in this path.
 * The only thing standing between Org A and Org B's row is the database.
 */
export async function attemptCrossTenantAccess(): Promise<IsolationProof> {
  const { a, b } = await ensureDemoData();

  // 0. Prove B's item is real — but only visible inside B's own context.
  const victimSelf = await withTenant(b.orgId, (tx) =>
    tx.knowledgeItem.findUnique({ where: { id: b.item.id } }),
  );

  // 1. THE ATTEMPT. Org A tries to read Org B's row, straight at the DB.
  const leaked = await withTenant(a.orgId, (tx) =>
    tx.knowledgeItem.findUnique({ where: { id: b.item.id } }),
  );

  // 2. CONTROL. Same query shape; Org A reads its OWN row → must succeed.
  const own = await withTenant(a.orgId, (tx) =>
    tx.knowledgeItem.findUnique({ where: { id: a.item.id } }),
  );

  return {
    attacker: { orgId: a.orgId, name: a.name },
    victim: { orgId: b.orgId, name: b.name, itemId: b.item.id, itemTitle: b.item.title },
    victimSelfRead: { found: victimSelf != null, title: victimSelf?.title ?? null },
    crossTenantRead: { rowCount: leaked ? 1 : 0, row: leaked ? toDemoItem(leaked) : null },
    controlRead: { rowCount: own ? 1 : 0, row: own ? toDemoItem(own) : null },
    blocked: leaked == null,
    controlOk: own != null,
  };
}
