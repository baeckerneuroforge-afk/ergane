// GET /api/slack/oauth/callback — completes the Slack install.
// Fail-closed on BOTH factors: the verified Clerk session's org must equal
// the org the signed state was issued for (CSRF/binding), then the code is
// exchanged and the encrypted token stored (src/lib/slack/oauth.ts).
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { completeSlackOAuth, verifyOAuthState } from '@/lib/slack/oauth';

export async function GET(req: Request): Promise<Response> {
  const { orgId, userId, role } = await requireTenant();
  if (role !== 'admin' && role !== 'owner') {
    return new Response('admin required', { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateOrg = verifyOAuthState(url.searchParams.get('state'));
  if (!code || !stateOrg || stateOrg !== orgId) {
    return new Response('invalid oauth state', { status: 403 });
  }

  await completeSlackOAuth({ orgId, actorUserId: userId, code });
  redirect('/dashboard/settings?tab=slack');
}
