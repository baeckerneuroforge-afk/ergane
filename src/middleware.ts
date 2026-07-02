import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Public routes need no session. Everything else requires a signed-in user AND
// an active organization. This is the first line of the tenant guard: a request
// can never reach a tenant page without a verified org in its session.
// /api/slack/* and /api/clerk/* are public by design: Slack and Clerk (Svix)
// call them without a Clerk session — both authenticate every request via
// their signature (src/lib/slack/handlers.ts, src/lib/clerk/webhooks.ts,
// fail-closed) before anything runs.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/slack(.*)',
  '/api/clerk(.*)',
]);
const isOrgSelectRoute = createRouteMatcher(['/select-org(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, orgId, redirectToSignIn } = await auth();

  // Not signed in → Clerk sign-in (401-equivalent redirect).
  if (!userId) {
    return redirectToSignIn();
  }

  // Signed in but no active org → force org selection/creation before any
  // tenant route. withTenant() would also refuse, but we stop it at the edge.
  if (!orgId && !isOrgSelectRoute(req)) {
    return NextResponse.redirect(new URL('/select-org', req.url));
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files...
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)',
    // ...and always on API routes.
    '/(api|trpc)(.*)',
  ],
};
