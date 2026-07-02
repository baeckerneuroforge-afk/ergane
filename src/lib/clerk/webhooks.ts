// Clerk webhook handler — keeps the local mirror (memberships) in sync with
// Clerk, the source of truth for WHO belongs to WHICH org.
//
// Why this matters for security: without it, a user removed from the Clerk
// org keeps their local membership — and with it their approval rights and
// Slack link — forever. This handler closes that hole.
//
// Same hard sequence as the Slack entry point, fail-closed:
//   1. SIGNATURE  — Svix HMAC over the raw body against CLERK_WEBHOOK_SECRET
//                   (±5 min window). Invalid ⇒ 401, nothing is parsed.
//   2. ORG SCOPE  — org-scoped events resolve clerk org id → internal UUID
//                   (same uuidv5 as the session path); everything runs in
//                   withTenant(orgId).
//   3. IDEMPOTENCY — org-scoped events claim `clerk:<svix-id>` per org (same
//                   atomic-claim mechanism as Slack). user.deleted carries no
//                   org and is naturally idempotent (deleting already-deleted
//                   memberships is a no-op) — documented, no claim.
//   4. Handling is synchronous — these are fast DB-only mutations (no LLM),
//                   well inside webhook timeouts; no defer needed.
//
// Handled events:
//   organizationMembership.created  → mirror membership (role_source 'clerk')
//   organizationMembership.updated  → sync role ONLY when role_source='clerk'
//                                     (a locally assigned 'lead' survives)
//   organizationMembership.deleted  → delete membership; the composite FK
//                                     cascades the slack_user_links row, so
//                                     the person can no longer act via Slack
//   user.deleted                    → remove the user's memberships in ALL
//                                     orgs (user_org_ids(), migration 0009)
//                                     and pseudonymize their audit actor id
//   organization.deleted            → audit marker ONLY. Deliberate decision:
//                                     tenant data is NOT auto-erased on a
//                                     Clerk-side deletion — offboarding is the
//                                     explicit, confirmed deleteOrganization()
//                                     path (Phase 7). Documented in README.
import { createHash } from 'node:crypto';
import type { Role } from '@prisma/client';
import { logAudit } from '../audit';
import { prisma } from '../prisma';
import { claimSlackEvent } from '../slack/idempotency';
import { withTenant } from '../tenant';
import { clerkOrgIdToUuid } from '../uuid';
import { verifySvixSignature } from './verify';

const WEBHOOK_ACTOR = 'clerk-webhook';

/** Clerk org role → local Role. Mirror of mapClerkRole in auth-context.ts,
 * duplicated here because auth-context imports 'server-only' (unavailable in
 * the test runtime). Keep both in sync; fail-closed to 'member'. */
function mapClerkRoleLocal(orgRole: string | null | undefined): Role {
  switch (orgRole) {
    case 'org:admin':
    case 'admin':
      return 'admin';
    default:
      return 'member';
  }
}

interface ClerkWebhookEvent {
  type?: string;
  data?: {
    id?: string; // user.deleted: the user id
    organization?: { id?: string; name?: string };
    public_user_data?: { user_id?: string };
    role?: string;
  };
}

/** Deterministic, non-reversible pseudonym for an erased user. */
function erasedActorId(userId: string): string {
  return `erased-${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`;
}

export async function handleClerkWebhook(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const svixId = req.headers.get('svix-id');
  const ok = verifySvixSignature({
    secret: process.env.CLERK_WEBHOOK_SECRET ?? '',
    rawBody,
    idHeader: svixId,
    timestampHeader: req.headers.get('svix-timestamp'),
    signatureHeader: req.headers.get('svix-signature'),
  });
  if (!ok) return new Response('invalid webhook signature', { status: 401 });

  const event = JSON.parse(rawBody) as ClerkWebhookEvent;
  const type = event.type ?? '';

  // ---- user-level erasure (no org context; naturally idempotent) -----------
  if (type === 'user.deleted') {
    const userId = event.data?.id ?? '';
    if (!userId) return new Response('ignored', { status: 200 });

    // Privileged lookup: WHICH orgs — then per-org work strictly in withTenant.
    const orgs = await prisma.$queryRaw<Array<{ user_org_ids: string }>>`
      SELECT user_org_ids(${userId})`;
    for (const { user_org_ids: orgId } of orgs) {
      await withTenant(orgId, async (tx) => {
        await tx.membership.deleteMany({ where: { userId } }); // cascades slack link
        await logAudit(tx, {
          orgId,
          actorId: WEBHOOK_ACTOR,
          actorType: 'agent',
          action: 'membership.removed_via_clerk',
          target: erasedActorId(userId),
          detail: { reason: 'user.deleted', via: 'clerk-webhook' },
        });
      });
      // Art. 17: erase the identifier from this tenant's audit trail. Uses an
      // admin-independent path: the webhook IS the authority here, so we call
      // the SQL function directly (the lifecycle wrapper checks a human admin).
      await withTenant(orgId, (tx) =>
        tx.$queryRaw`SELECT pseudonymize_audit_actor(${userId}, ${erasedActorId(userId)})`,
      );
    }
    return Response.json({ ok: true, orgs: orgs.length });
  }

  // ---- org-scoped events ----------------------------------------------------
  const clerkOrgId = event.data?.organization?.id ?? '';
  if (!clerkOrgId) return new Response('ignored', { status: 200 });
  const orgId = clerkOrgIdToUuid(clerkOrgId);

  // The org may not be mirrored yet (webhook before first dashboard load) —
  // membership events for unknown orgs are acked and skipped, fail-closed.
  const known = await withTenant(orgId, (tx) =>
    tx.organization.findUnique({ where: { id: orgId } }),
  );
  if (!known) return new Response('organization not mirrored — ignored', { status: 200 });

  // Idempotency: one svix delivery = one effect (per org).
  if (svixId && !(await claimSlackEvent(orgId, `clerk:${svixId}`))) {
    return new Response('duplicate delivery ignored', { status: 200 });
  }

  const userId = event.data?.public_user_data?.user_id ?? '';

  if (type === 'organizationMembership.deleted') {
    if (!userId) return new Response('ignored', { status: 200 });
    await withTenant(orgId, async (tx) => {
      const { count } = await tx.membership.deleteMany({ where: { userId } });
      if (count > 0) {
        await logAudit(tx, {
          orgId,
          actorId: WEBHOOK_ACTOR,
          actorType: 'agent',
          action: 'membership.removed_via_clerk',
          target: `membership:${userId}`,
          detail: { reason: 'organizationMembership.deleted', via: 'clerk-webhook' },
        });
      }
    });
    return Response.json({ ok: true });
  }

  if (type === 'organizationMembership.created' || type === 'organizationMembership.updated') {
    if (!userId) return new Response('ignored', { status: 200 });
    const clerkRole: Role = mapClerkRoleLocal(event.data?.role);

    await withTenant(orgId, async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { orgId_userId: { orgId, userId } },
      });
      if (!existing) {
        await tx.membership.create({
          data: { orgId, userId, role: clerkRole, roleSource: 'clerk' },
        });
        await logAudit(tx, {
          orgId, actorId: WEBHOOK_ACTOR, actorType: 'agent',
          action: 'membership.synced_via_clerk',
          target: `membership:${userId}`,
          detail: { role: clerkRole, via: 'clerk-webhook' },
        });
        return;
      }
      // A locally assigned role (e.g. 'lead') is NEVER overwritten by a sync.
      if (existing.roleSource !== 'clerk' || existing.role === clerkRole) return;
      await tx.membership.update({
        where: { id: existing.id },
        data: { role: clerkRole },
      });
      await logAudit(tx, {
        orgId, actorId: WEBHOOK_ACTOR, actorType: 'agent',
        action: 'membership.synced_via_clerk',
        target: `membership:${userId}`,
        detail: { old: existing.role, new: clerkRole, via: 'clerk-webhook' },
      });
    });
    return Response.json({ ok: true });
  }

  if (type === 'organization.deleted') {
    // Deliberate: NO auto-erasure. Offboarding stays the explicit Phase-7 path.
    await withTenant(orgId, (tx) =>
      logAudit(tx, {
        orgId, actorId: WEBHOOK_ACTOR, actorType: 'agent',
        action: 'org.clerk_deleted',
        detail: {
          via: 'clerk-webhook',
          note: 'Clerk org deleted; local data retained until explicit deleteOrganization()',
        },
      }),
    );
    return Response.json({ ok: true });
  }

  return new Response('ignored', { status: 200 });
}
