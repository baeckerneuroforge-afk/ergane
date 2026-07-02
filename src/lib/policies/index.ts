// Governance policies — tenant-configurable, INSIDE the RLS floor.
//
// Two layers, never confused:
//   1. RLS + FORCE (migrations 0001–0004) is the hard floor: tenant separation,
//      enforced by Postgres. Policies cannot open anything across tenants —
//      every read/write here runs in withTenant(), so a tenant only ever sees
//      and edits its OWN policies.
//   2. These policies configure behavior WITHIN a tenant: when skill runs need
//      a human approval (approval_policies) and which roles may see which
//      knowledge (documents.visibility + visibility_grants).
//
// Fail-closed defaults everywhere:
//   - no approval policy       → the skill's own guardrail / handlesMoney rules
//   - no visibility grant      → the role sees only 'open' documents
//   - unknown/missing role     → only 'open'
//   - policy mode 'never' on a money skill → overridden at runtime (engine)
//
// Only 'admin' (or the explicitly elevated 'owner') may change policies; every
// change writes audit 'policy.changed' with { old, new } in detail.
import type { ApprovalMode, ApprovalPolicy, DocumentVisibility, Membership, Role } from '@prisma/client';
import { logAudit } from '../audit';
import { withTenant, type Tx } from '../tenant';

/** Roles allowed to administer policies. */
const ADMIN_ROLES: Role[] = ['admin', 'owner'];
/** Roles a policy may demand for approvals. */
const APPROVER_ROLES: Role[] = ['admin', 'lead'];
/** Visibility levels that are grantable ('open' needs no grant). */
const GRANTABLE_LEVELS: DocumentVisibility[] = ['restricted', 'confidential'];

/** True when `decider` (with `deciderRole`) satisfies `required`. 'admin' and
 * 'owner' always qualify; otherwise the roles must match exactly. */
export function roleSatisfies(deciderRole: Role, required: Role): boolean {
  return ADMIN_ROLES.includes(deciderRole) || deciderRole === required;
}

/** Membership lookup inside the CALLER's tenant transaction. Fail-closed: no
 * membership row ⇒ null (treated as "no role" by every consumer). */
export async function getMemberRole(tx: Tx, userId: string): Promise<Role | null> {
  const membership = await tx.membership.findFirst({ where: { userId } });
  return membership?.role ?? null;
}

async function requireAdmin(tx: Tx, orgId: string, actorUserId: string): Promise<Role> {
  const role = await getMemberRole(tx, actorUserId);
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `policies: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not change policies — admin required.`,
    );
  }
  return role;
}

// -----------------------------------------------------------------------------
// Approval policies
// -----------------------------------------------------------------------------

export async function getApprovalPolicy(
  orgId: string,
  skillKey: string,
): Promise<ApprovalPolicy | null> {
  return withTenant(orgId, (tx) =>
    tx.approvalPolicy.findUnique({ where: { orgId_skillKey: { orgId, skillKey } } }),
  );
}

export interface SetApprovalPolicyInput {
  orgId: string;
  /** The human changing the policy — must hold the admin role in this org. */
  actorUserId: string;
  skillKey: string;
  mode: ApprovalMode;
  /** Required for mode 'threshold'; must be > 0. */
  thresholdAmount?: number;
  /** Role that may decide the resulting approvals (default 'lead'). */
  approverRole?: Role;
}

export async function setApprovalPolicy(input: SetApprovalPolicyInput): Promise<ApprovalPolicy> {
  const { orgId, actorUserId, skillKey, mode } = input;
  if (!skillKey.trim()) throw new Error('setApprovalPolicy: skillKey is required.');

  const approverRole = input.approverRole ?? 'lead';
  if (!APPROVER_ROLES.includes(approverRole)) {
    throw new Error(`setApprovalPolicy: approverRole must be one of ${APPROVER_ROLES.join('|')}.`);
  }
  let thresholdAmount: number | null = null;
  if (mode === 'threshold') {
    if (typeof input.thresholdAmount !== 'number' || !(input.thresholdAmount > 0)) {
      throw new Error('setApprovalPolicy: mode "threshold" requires thresholdAmount > 0.');
    }
    thresholdAmount = input.thresholdAmount;
  }

  return withTenant(orgId, async (tx) => {
    await requireAdmin(tx, orgId, actorUserId);

    const old = await tx.approvalPolicy.findUnique({
      where: { orgId_skillKey: { orgId, skillKey } },
    });
    const data = { mode, thresholdAmount, approverRole };
    const saved = await tx.approvalPolicy.upsert({
      where: { orgId_skillKey: { orgId, skillKey } },
      create: { orgId, skillKey, ...data },
      update: data,
    });

    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: `approval_policy:${skillKey}`,
      detail: {
        old: old
          ? { mode: old.mode, thresholdAmount: old.thresholdAmount?.toNumber() ?? null, approverRole: old.approverRole }
          : null,
        new: { mode, thresholdAmount, approverRole },
      },
    });
    return saved;
  });
}

// -----------------------------------------------------------------------------
// Disclosure policies (document visibility + grants)
// -----------------------------------------------------------------------------

export interface SetDocumentVisibilityInput {
  orgId: string;
  actorUserId: string;
  documentId: string;
  visibility: DocumentVisibility;
}

export async function setDocumentVisibility(input: SetDocumentVisibilityInput): Promise<void> {
  const { orgId, actorUserId, documentId, visibility } = input;

  await withTenant(orgId, async (tx) => {
    await requireAdmin(tx, orgId, actorUserId);

    // RLS scopes the lookup to the tenant; a foreign documentId is "not found".
    const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
    if (doc.visibility === visibility) return;

    await tx.document.update({ where: { id: documentId }, data: { visibility } });
    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: `document_visibility:${doc.title}`,
      detail: { documentId, old: doc.visibility, new: visibility },
    });
  });
}

export interface SetVisibilityGrantInput {
  orgId: string;
  actorUserId: string;
  level: DocumentVisibility;
  role: Role;
  /** true = role may see the level; false = revoke. */
  allowed: boolean;
}

export async function setVisibilityGrant(input: SetVisibilityGrantInput): Promise<void> {
  const { orgId, actorUserId, level, role, allowed } = input;
  if (!GRANTABLE_LEVELS.includes(level)) {
    throw new Error(`setVisibilityGrant: level must be one of ${GRANTABLE_LEVELS.join('|')} ('open' needs no grant).`);
  }

  await withTenant(orgId, async (tx) => {
    await requireAdmin(tx, orgId, actorUserId);

    const existing = await tx.visibilityGrant.findUnique({
      where: { orgId_level_role: { orgId, level, role } },
    });
    if (allowed && !existing) {
      await tx.visibilityGrant.create({ data: { orgId, level, role } });
    } else if (!allowed && existing) {
      await tx.visibilityGrant.delete({ where: { id: existing.id } });
    } else {
      return; // no change, no audit noise
    }

    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: `visibility_grant:${level}:${role}`,
      detail: { level, role, old: Boolean(existing), new: allowed },
    });
  });
}

// -----------------------------------------------------------------------------
// Memberships (role administration)
// -----------------------------------------------------------------------------

/** Roles an admin may assign via the UI. 'owner' stays manual-elevation only. */
const ASSIGNABLE_ROLES: Role[] = ['admin', 'lead', 'member'];

export interface SetMembershipRoleInput {
  orgId: string;
  /** The human changing the role — must hold the admin role in this org. */
  actorUserId: string;
  /** The member whose role changes; must have a membership in THIS tenant. */
  userId: string;
  role: Role;
}

/**
 * Change a member's role within the caller's tenant. Admin-only, RLS-scoped
 * (a foreign userId is simply "not found"), and guarded so the tenant can never
 * lose its last admin-tier member ('admin' or 'owner'). Every change writes
 * audit 'membership.role_changed' with { old, new }.
 */
export async function setMembershipRole(input: SetMembershipRoleInput): Promise<Membership> {
  const { orgId, actorUserId, userId, role } = input;
  if (!userId.trim()) throw new Error('setMembershipRole: userId is required.');
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new Error(`setMembershipRole: role must be one of ${ASSIGNABLE_ROLES.join('|')}.`);
  }

  return withTenant(orgId, async (tx) => {
    await requireAdmin(tx, orgId, actorUserId);

    const membership = await tx.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) {
      throw new Error(`setMembershipRole: no membership for user ${JSON.stringify(userId)} in this tenant.`);
    }
    if (membership.role === role) return membership; // no change, no audit noise

    // Last-admin guard: demoting the only admin-tier member would lock the
    // tenant out of all governance changes — refuse.
    if (ADMIN_ROLES.includes(membership.role) && !ADMIN_ROLES.includes(role)) {
      const adminCount = await tx.membership.count({ where: { role: { in: ADMIN_ROLES } } });
      if (adminCount <= 1) {
        throw new Error(
          'setMembershipRole: cannot demote the last admin — at least one admin must remain.',
        );
      }
    }

    const saved = await tx.membership.update({
      where: { id: membership.id },
      data: { role },
    });
    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'membership.role_changed',
      target: `membership:${userId}`,
      detail: { userId, old: membership.role, new: role },
    });
    return saved;
  });
}
