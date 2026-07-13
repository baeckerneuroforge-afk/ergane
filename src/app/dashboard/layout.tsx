import { isUsingFakeAiProviders } from '@/lib/ai';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { ensureOrgAndMembership } from '@/lib/org';
import { withTenant } from '@/lib/tenant';
import { FakeAiBanner } from './fake-ai-banner';
import { DashboardShell } from './shell';

// Session + live badge count → always dynamic.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, clerkOrgId, orgId, orgSlug, role } = await requireTenant();
  const { t } = await getI18n();

  // Mirror the Clerk org + caller's membership into our DB (idempotent) —
  // approve()/reject()'s role gate reads this membership.
  await ensureOrgAndMembership({
    clerkOrgId,
    name: orgSlug ?? clerkOrgId,
    userId,
    role,
  });

  // Nav badge = open work items on loop_flags (status=open). Must NOT count
  // flag.status_changed audit rows (ack/resolve would inflate the badge).
  const { org, pendingApprovals, openFlags } = await withTenant(orgId, async (tx) => ({
    org: await tx.organization.findUnique({ where: { id: orgId } }),
    pendingApprovals: await tx.approval.count({ where: { status: 'pending' } }),
    openFlags: await tx.loopFlag.count({ where: { status: 'open' } }),
  }));

  const showFakeAi = isUsingFakeAiProviders();

  return (
    <DashboardShell
      tenantName={org?.name ?? orgSlug ?? clerkOrgId}
      role={role}
      pendingApprovals={pendingApprovals}
      openFlags={openFlags}
    >
      {showFakeAi ? <FakeAiBanner dict={t.fakeAiBanner} /> : null}
      {children}
    </DashboardShell>
  );
}
