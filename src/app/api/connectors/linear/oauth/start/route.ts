// GET /api/connectors/linear/oauth/start — begin Linear OAuth for current org.
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { buildLinearAuthorizeUrl, makeLinearOAuthState } from '@/lib/connectors/linear';

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
  const redirectUri = `${url.origin}/api/connectors/linear/oauth/callback`;
  redirect(buildLinearAuthorizeUrl(makeLinearOAuthState(ctx.orgId), redirectUri));
}
