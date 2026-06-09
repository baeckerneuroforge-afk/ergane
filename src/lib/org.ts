import type { Role } from '@prisma/client';
import { prisma } from './prisma';
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

  // organizations has no RLS (it is the tenant root), so this upsert is safe
  // without a tenant context. The id is deterministic, so it is idempotent.
  await prisma.organization.upsert({
    where: { clerkOrgId: opts.clerkOrgId },
    create: { id: orgId, clerkOrgId: opts.clerkOrgId, name: opts.name },
    update: { name: opts.name },
  });

  // memberships IS tenant-scoped → the upsert must run inside the tenant context
  // so RLS USING/WITH CHECK accept it.
  await withTenant(orgId, (tx) =>
    tx.membership.upsert({
      where: { orgId_userId: { orgId, userId: opts.userId } },
      create: { orgId, userId: opts.userId, role: opts.role },
      update: { role: opts.role },
    }),
  );

  return orgId;
}
