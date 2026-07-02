// GET /api/slack/oauth/start — begins the Slack install for the CURRENT org.
// Requires a signed-in admin (Clerk session; the /api/slack public exemption
// only skips the middleware redirect — auth() still resolves here) and binds
// the flow to the org via a signed, expiring state.
//
// The membership is mirrored FIRST (ensureOrgAndMembership): the callback's
// createSlackInstallation() checks the admin role against the DB membership,
// which may not exist yet if this admin never loaded the dashboard.
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { buildAuthorizeUrl, makeOAuthState } from '@/lib/slack/oauth';

export async function GET(): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return new Response('sign-in with an active organization required', { status: 401 });
  }
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    return new Response('admin required', { status: 403 });
  }
  await ensureOrgAndMembership({
    clerkOrgId: ctx.clerkOrgId,
    name: ctx.orgSlug ?? ctx.clerkOrgId,
    userId: ctx.userId,
    role: ctx.role,
  });
  redirect(buildAuthorizeUrl(makeOAuthState(ctx.orgId)));
}
