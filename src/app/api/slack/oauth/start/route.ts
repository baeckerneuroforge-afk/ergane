// GET /api/slack/oauth/start — begins the Slack install for the CURRENT org.
// Requires a signed-in admin (Clerk session; the /api/slack public exemption
// only skips the middleware redirect — auth() still resolves here) and binds
// the flow to the org via a signed, expiring state.
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { buildAuthorizeUrl, makeOAuthState } from '@/lib/slack/oauth';

export async function GET(): Promise<Response> {
  const { orgId, role } = await requireTenant();
  if (role !== 'admin' && role !== 'owner') {
    return new Response('admin required', { status: 403 });
  }
  redirect(buildAuthorizeUrl(makeOAuthState(orgId)));
}
