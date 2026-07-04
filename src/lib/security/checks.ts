// =============================================================================
// SECURITY CHECKS — the honest core of the Security view.
//
// This module answers one question per structural guarantee: "is it actually
// in place right now, and how do we KNOW?". Two kinds of answer, never mixed:
//
//   • basis: 'live'         — we query the running database's SCHEMA CATALOGS
//                             (pg_class, pg_policies, pg_trigger) and report the
//                             real result. This can, and MUST be able to, come
//                             back NOT green — if someone drops FORCE or adds an
//                             UPDATE policy to audit_log, the tile flips to fail.
//                             That falsifiability is the whole point.
//
//   • basis: 'test' | 'architecture'
//                           — a guarantee that is NOT a momentary DB status
//                             (e.g. "money skills fail closed"). We do NOT fake a
//                             live green light for these. We state plainly that
//                             they are secured by the test suite / by the
//                             architecture, and point at the verifiable basis
//                             (the CI gate, the test files, the code).
//
// HONESTY RULES (do not weaken):
//   - No "certified" language, no self-issued seal. We claim only what we can
//     show: the public repo, the CI gate, the test count, the live query.
//   - A live check reads ONLY aggregated schema structure (table names, RLS
//     flags, policy/trigger existence). It never reads a tenant row, a customer
//     record, or another org's data. It runs as the least-privileged app_user.
//   - Where no honest live check exists, label it 'test'/'architecture' — never
//     a hardcoded "OK" pretending it was just verified live.
// =============================================================================
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { withTenant } from '../tenant';
import { requireAdmin } from '../policies/admin';
import { listSkills } from '../skills';
import { getEmbeddingProvider } from '../ai';

/** Where a property's status comes from — the honesty axis. */
export type Basis = 'live' | 'test' | 'architecture';

/**
 * Outcome of a property.
 *   - 'pass'     : verified good (live query returned the expected structure, or
 *                  the guarantee is architecturally/test-secured and holds).
 *   - 'fail'     : a LIVE check found the structure is NOT as required. This is
 *                  the "could go red" case — a real regression signal.
 *   - 'unknown'  : a live check could not run (e.g. DB unreachable). We say so
 *                  rather than defaulting to green.
 */
export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface SecurityProperty {
  /** Stable key — used for i18n lookup and as a test anchor. */
  key: SecurityPropertyKey;
  basis: Basis;
  status: CheckStatus;
  /**
   * Machine-readable evidence for the UI to render as the "Grundlage" line.
   * For live checks this is the real measured value (e.g. "4/4"); for
   * test/architecture it names the verifiable source (test files / CI gate).
   */
  evidence: Evidence;
}

export type SecurityPropertyKey =
  | 'tenantIsolation'
  | 'auditImmutability'
  | 'moneyFailsafe'
  | 'antiHallucination'
  | 'euDataResidency';

/** Structured, locale-independent evidence. The page turns this into prose. */
export type Evidence =
  | { kind: 'rlsCount'; total: number; secured: number; tables: string[] }
  | { kind: 'auditPolicies'; policies: string[]; hasUpdateOrDelete: boolean; triggers: string[] }
  | { kind: 'moneySkills'; total: number }
  | { kind: 'threshold'; value: number }
  | { kind: 'statement' }
  | { kind: 'error'; message: string };

// The tenant tables whose RLS+FORCE we verify live. This is the SINGLE source of
// truth for that set: tests/isolation.test.ts imports it, and the live query
// below builds its IN-list from it — so a new tenant table is added in exactly
// one place. The isolation gate asserts the same tables under RLS.
export const TENANT_TABLES = [
  'organizations',
  'memberships',
  'knowledge_items',
  'audit_log',
  'clients',
  'artifacts',
] as const;

/**
 * LIVE CHECK 1 — Tenant isolation: every tenant table has RLS ENABLE *and*
 * FORCE. Reads pg_class only (relrowsecurity / relforcerowsecurity). This is the
 * exact catalog query the isolation gate uses. Runs as app_user; the system
 * catalogs are readable, but this touches NO tenant data whatsoever.
 *
 * Fails (status 'fail') if any table is missing, has RLS disabled, or has lost
 * FORCE — the same regressions the gate guards against.
 */
export async function checkTenantIsolation(): Promise<SecurityProperty> {
  try {
    // IN-list built from TENANT_TABLES (single source of truth) via bind
    // parameters — no string interpolation, and no drift from the constant.
    const rows = await prisma.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >(Prisma.sql`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN (${Prisma.join(TENANT_TABLES.map((t) => t))})`);

    const byName = new Map(rows.map((r) => [r.relname, r]));
    const securedTables = TENANT_TABLES.filter((t) => {
      const r = byName.get(t);
      return r?.relrowsecurity === true && r?.relforcerowsecurity === true;
    });

    return {
      key: 'tenantIsolation',
      basis: 'live',
      status: securedTables.length === TENANT_TABLES.length ? 'pass' : 'fail',
      evidence: {
        kind: 'rlsCount',
        total: TENANT_TABLES.length,
        secured: securedTables.length,
        tables: [...TENANT_TABLES],
      },
    };
  } catch (e) {
    return liveError('tenantIsolation', e);
  }
}

/**
 * LIVE CHECK 2 — Audit immutability: the audit_log is append-only. Two
 * independent guards, both read from schema catalogs (no audit CONTENT is read):
 *   (a) RLS: pg_policies for audit_log must expose ONLY INSERT + SELECT — the
 *       ABSENCE of any UPDATE/DELETE policy under FORCE RLS is what denies them.
 *   (b) Trigger (defense in depth): pg_trigger must carry the two guard triggers
 *       that reject UPDATE/DELETE even for the table owner.
 *
 * Fails if an UPDATE/DELETE policy appears, or if a guard trigger is missing.
 */
export async function checkAuditImmutability(): Promise<SecurityProperty> {
  try {
    // Two independent catalog reads — issued together.
    const [policyRows, triggerRows] = await Promise.all([
      prisma.$queryRaw<Array<{ policyname: string; cmd: string; permissive: string }>>`
        SELECT policyname, cmd, permissive FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'audit_log'`,
      prisma.$queryRaw<Array<{ tgname: string }>>`
        SELECT t.tgname FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'audit_log' AND NOT t.tgisinternal`,
    ]);

    // cmd ∈ {SELECT, INSERT, UPDATE, DELETE, ALL}. Only a PERMISSIVE policy
    // GRANTS a command; a RESTRICTIVE one only tightens (denies) it — so a
    // restrictive UPDATE/DELETE deny actually STRENGTHENS append-only and must
    // NOT be counted as a violation. We therefore consider permissive rows only.
    const permissiveCmds = policyRows
      .filter((p) => p.permissive.toUpperCase() === 'PERMISSIVE')
      .map((p) => p.cmd.toUpperCase());
    const hasUpdateOrDelete = permissiveCmds.some(
      (c) => c === 'UPDATE' || c === 'DELETE' || c === 'ALL',
    );
    // Full command list (permissive + restrictive) is still surfaced as evidence.
    const cmds = policyRows.map((p) => p.cmd.toUpperCase());
    const triggers = triggerRows.map((t) => t.tgname).sort();
    const hasBothGuards =
      triggers.includes('audit_log_no_update') && triggers.includes('audit_log_no_delete');

    return {
      key: 'auditImmutability',
      basis: 'live',
      status: !hasUpdateOrDelete && hasBothGuards ? 'pass' : 'fail',
      evidence: {
        kind: 'auditPolicies',
        policies: cmds.sort(),
        hasUpdateOrDelete,
        triggers,
      },
    };
  } catch (e) {
    return liveError('auditImmutability', e);
  }
}

/**
 * TEST-SECURED — Money failsafe: a money-touching skill can never act without a
 * human decision. This is NOT a live DB status: it is enforced in the engine
 * (write time + runtime, defense in depth) and pinned by the test suite. We
 * report it honestly as test-secured and surface the ONE structural number we
 * can derive from the skill catalog: how many money skills exist and how many
 * are guarded-or-fail-closed (a money skill without a guardrail fails closed =
 * always requires approval; see engine.ts skillDefaultGate).
 */
export function checkMoneyFailsafe(): SecurityProperty {
  // The number that actually carries information is simply how many money skills
  // exist: EVERY one is gated by the engine (with a guardrail it gates on it,
  // without one skillDefaultGate fails closed → always approval). There is no
  // "some safe, some not" split to report — the failsafe is unconditional — so
  // we surface the one honest count and leave the guarantee to the tests. This
  // is test-secured, not a live status, which is why basis is 'test'.
  const moneySkillCount = listSkills().filter((s) => s.handlesMoney).length;

  return {
    key: 'moneyFailsafe',
    basis: 'test',
    status: 'pass',
    evidence: { kind: 'moneySkills', total: moneySkillCount },
  };
}

/**
 * ARCHITECTURE-SECURED — Anti-hallucination: below the relevance threshold the
 * LLM is never called, and answers carry only cited sources. Not a live status;
 * it is how the RAG pipeline is built (src/lib/rag/answer.ts). We surface the
 * active relevance threshold as the concrete, verifiable parameter.
 */
export function checkAntiHallucination(): SecurityProperty {
  // getEmbeddingProvider() throws in production when the embedding key is unset
  // (it refuses to fall back to the fake provider). One misconfigured probe must
  // not take down the whole Security view — degrade this single tile to
  // 'unknown', exactly like the DB-unreachable path of the live checks. We never
  // paper over it with a fake green.
  try {
    const threshold = getEmbeddingProvider().relevanceThreshold;
    return {
      key: 'antiHallucination',
      basis: 'architecture',
      status: 'pass',
      evidence: { kind: 'threshold', value: threshold },
    };
  } catch (e) {
    return {
      key: 'antiHallucination',
      basis: 'architecture',
      status: 'unknown',
      evidence: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * STATEMENT — EU data residency & no training on customer data. This is a
 * deployment/contract fact, not something to probe live. Reported as a plain
 * statement, explicitly NOT as a momentary check.
 */
export function checkEuDataResidency(): SecurityProperty {
  return {
    key: 'euDataResidency',
    basis: 'architecture',
    status: 'pass',
    evidence: { kind: 'statement' },
  };
}

/**
 * Assemble every property for the Security view. The two live checks hit the DB
 * (schema catalogs only); the rest are pure. Order = display order.
 */
export async function collectSecurityProperties(): Promise<SecurityProperty[]> {
  const [tenant, audit] = await Promise.all([
    checkTenantIsolation(),
    checkAuditImmutability(),
  ]);
  return [
    tenant,
    audit,
    checkMoneyFailsafe(),
    checkAntiHallucination(),
    checkEuDataResidency(),
  ];
}

/**
 * Admin-gated entry point for the Security view. This is the SERVER-SIDE truth:
 * before returning anything it verifies the caller is an admin/owner INSIDE the
 * caller's tenant transaction (requireAdmin reads the membership under RLS and
 * fails closed). A member is rejected with the standard "admin required" error —
 * exactly like every governance mutation. The page's redirect gate is a
 * convenience on top of this, not a replacement for it.
 *
 * Note the security PROPERTIES themselves are org-independent schema facts and
 * carry no tenant data; the tenant transaction exists only to authenticate the
 * caller's role — nothing sensitive is read from it.
 */
export async function loadSecurityView(params: {
  orgId: string;
  actorUserId: string;
}): Promise<SecurityProperty[]> {
  await withTenant(params.orgId, (tx) => requireAdmin(tx, params.orgId, params.actorUserId));
  return collectSecurityProperties();
}

/** A live check that could not run — reported as 'unknown', never as green. */
function liveError(key: SecurityPropertyKey, e: unknown): SecurityProperty {
  return {
    key,
    basis: 'live',
    status: 'unknown',
    evidence: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
  };
}
