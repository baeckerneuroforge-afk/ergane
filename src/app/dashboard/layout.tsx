import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { withTenant } from '@/lib/tenant';
import { DashboardShell } from './shell';

// Session + live badge count → always dynamic.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, clerkOrgId, orgId, orgSlug, role } = await requireTenant();

  // Mirror the Clerk org + caller's membership into our DB (idempotent) —
  // approve()/reject()'s role gate reads this membership.
  await ensureOrgAndMembership({
    clerkOrgId,
    name: orgSlug ?? clerkOrgId,
    userId,
    role,
  });

  const { org, pendingApprovals } = await withTenant(orgId, async (tx) => ({
    org: await tx.organization.findUnique({ where: { id: orgId } }),
    pendingApprovals: await tx.approval.count({ where: { status: 'pending' } }),
  }));

  return (
    <DashboardShell
      tenantName={org?.name ?? orgSlug ?? clerkOrgId}
      role={role}
      pendingApprovals={pendingApprovals}
    >
      {children}
    </DashboardShell>
  );
}
