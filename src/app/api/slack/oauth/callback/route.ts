// GET /api/slack/oauth/callback — completes the Slack install.
// Fail-closed on BOTH factors: the verified Clerk session's org must equal
// the org the signed state was issued for (CSRF/binding), then the code is
// exchanged and the encrypted token stored (src/lib/slack/oauth.ts).
// The membership is mirrored first — completeSlackOAuth()'s admin gate reads
// the DB membership.
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { completeSlackOAuth, verifyOAuthState } from '@/lib/slack/oauth';

export async function GET(req: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return new Response('sign-in with an active organization required', { status: 401 });
  }
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    return new Response('admin required', { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateOrg = verifyOAuthState(url.searchParams.get('state'));
  if (!code || !stateOrg || stateOrg !== ctx.orgId) {
    return new Response('invalid oauth state', { status: 403 });
  }

  await ensureOrgAndMembership({
    clerkOrgId: ctx.clerkOrgId,
    name: ctx.orgSlug ?? ctx.clerkOrgId,
    userId: ctx.userId,
    role: ctx.role,
  });
  await completeSlackOAuth({ orgId: ctx.orgId, actorUserId: ctx.userId, code });
  redirect('/dashboard/settings?tab=slack');
}
