// GET /dashboard/settings/export — full tenant export (Art. 20) as a JSON
// download. Protected by the Clerk middleware like every dashboard route;
// the admin gate + audit live in exportOrgData() (src/lib/lifecycle/).
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { exportOrgData } from '@/lib/lifecycle';

export async function GET(): Promise<Response> {
  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });

  const data = await exportOrgData({ orgId, actorUserId: userId });

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="ergane-export-${orgId}.json"`,
    },
  });
}
