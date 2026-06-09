import 'server-only';
import { auth } from '@clerk/nextjs/server';
import type { Role } from '@prisma/client';
import { clerkOrgIdToUuid } from './uuid';

/**
 * Map a Clerk organization role to our local Role enum. Clerk's default org
 * roles are "org:admin" and "org:member". We never derive "owner" from Clerk;
 * it exists for explicit, manual elevation only.
 *
 * NOTE (Phase 0-1): the mirrored `memberships.role` is ADVISORY. This foundation
 * does not yet enforce intra-tenant RBAC (no business actions exist to gate). If
 * you add role-gated actions later, enforce the check in the server action AND
 * broaden this mapping to your custom Clerk role keys (failing closed to member
 * only for genuinely unknown roles).
 */
export function mapClerkRole(orgRole: string | null | undefined): Role {
  switch (orgRole) {
    case 'org:admin':
    case 'admin':
      return 'admin';
    default:
      return 'member';
  }
}

export interface TenantContext {
  userId: string;
  clerkOrgId: string;
  /** Internal org UUID — the value passed to withTenant(). */
  orgId: string;
  orgSlug: string | null;
  role: Role;
}

/**
 * Resolve the tenant context from the VERIFIED Clerk session — the single
 * trusted source of the active org. The org id is taken from the session only,
 * never from a request body or query parameter, then mapped to our internal
 * UUID server-side. Throws if there is no signed-in user or no active org
 * (middleware already redirects those cases; this is the defense-in-depth guard
 * for code paths that reach the DB).
 */
export async function requireTenant(): Promise<TenantContext> {
  const { userId, orgId: clerkOrgId, orgRole, orgSlug } = await auth();

  if (!userId) {
    throw new Error('requireTenant: not authenticated.');
  }
  if (!clerkOrgId) {
    throw new Error('requireTenant: no active organization in session.');
  }

  return {
    userId,
    clerkOrgId,
    orgId: clerkOrgIdToUuid(clerkOrgId),
    orgSlug: orgSlug ?? null,
    role: mapClerkRole(orgRole),
  };
}
