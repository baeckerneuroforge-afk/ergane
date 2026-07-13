import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { buildGitHubAuthorizeUrl, makeGitHubOAuthState } from '@/lib/connectors/github';

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
  await ensureOrgAndMembership({
    clerkOrgId: ctx.clerkOrgId,
    name: ctx.orgSlug ?? ctx.clerkOrgId,
    userId: ctx.userId,
    role: ctx.role,
  });
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/connectors/github/oauth/callback`;
  redirect(buildGitHubAuthorizeUrl(makeGitHubOAuthState(ctx.orgId), redirectUri));
}
