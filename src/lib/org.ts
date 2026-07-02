import type { Role } from '@prisma/client';
import { withTenant } from './tenant';
import { clerkOrgIdToUuid } from './uuid';

/**
 * Ensure our database mirrors a Clerk organization (and the caller's membership)
 * before any tenant-scoped work happens. Clerk is the source of truth for who
 * belongs to which org; we mirror just enough to satisfy the FK from tenant rows
 * to `organizations` and to keep a local membership record.
 *
 * Returns the internal org UUID to use as the tenant key in withTenant().
 */
export async function ensureOrgAndMembership(opts: {
  clerkOrgId: string;
  name: string;
  userId: string;
  role: Role;
}): Promise<string> {
  const orgId = clerkOrgIdToUuid(opts.clerkOrgId);

  // Both tables are RLS-protected, so the whole bootstrap runs inside ONE tenant
  // context. The org's `id` IS the tenant key, so its self-row policy accepts the
  // INSERT/UPDATE (id = current_org). The id is deterministic → idempotent.
  await withTenant(orgId, async (tx) => {
    await tx.organization.upsert({
      where: { id: orgId },
      create: { id: orgId, clerkOrgId: opts.clerkOrgId, name: opts.name },
      update: { name: opts.name },
    });

    // role_source 'local' (e.g. the org-internal 'lead' set via settings) is
    // never overwritten by this Clerk mirror — only 'clerk'-sourced roles sync.
    const existing = await tx.membership.findUnique({
      where: { orgId_userId: { orgId, userId: opts.userId } },
    });
    if (!existing) {
      await tx.membership.create({
        data: { orgId, userId: opts.userId, role: opts.role, roleSource: 'clerk' },
      });
    } else if (existing.roleSource === 'clerk' && existing.role !== opts.role) {
      await tx.membership.update({
        where: { id: existing.id },
        data: { role: opts.role },
      });
    }
  });

  return orgId;
}
