import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, cspHeaderName, generateCspNonce } from '@/lib/csp';

// Public routes need no session. Everything else requires a signed-in user AND
// an active organization. This is the first line of the tenant guard: a request
// can never reach a tenant page without a verified org in its session.
// /api/slack/* and /api/clerk/* are public by design: Slack and Clerk (Svix)
// call them without a Clerk session — both authenticate every request via
// their signature (src/lib/slack/handlers.ts, src/lib/clerk/webhooks.ts,
// fail-closed) before anything runs.
const isPublicRoute = createRouteMatcher([
  // Öffentliche Seiten: Landing + Rechtsseiten (kein Tenant-Bezug; die
  // Landing leitet eingeloggte Nutzer selbst ins Dashboard weiter).
  '/',
  '/impressum',
  '/datenschutz',
  '/avv',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/slack(.*)',
  '/api/clerk(.*)',
  // Uptime checks — returns only up/down, no tenant data (Phase 13).
  '/api/health',
  // Vercel Cron — authenticates itself via CRON_SECRET (fail-closed in the
  // route; without the secret it answers 503/401, never runs).
  '/api/cron(.*)',
]);
const isOrgSelectRoute = createRouteMatcher(['/select-org(.*)']);

/** CSP with a per-request nonce on every PAGE response (Phase 16). API routes
 * skip it (no HTML). The nonce+CSP go onto the REQUEST headers so Next applies
 * the nonce to its own inline scripts, and onto the RESPONSE for the browser.
 * Report-Only by default; CSP_ENFORCE=true enforces (see src/lib/csp.ts). */
function withCsp(req: NextRequest): NextResponse {
  const nonce = generateCspNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(cspHeaderName(), csp);
  return res;
}

export default clerkMiddleware(async (auth, req) => {
  const isApi = req.nextUrl.pathname.startsWith('/api/');

  if (isPublicRoute(req)) {
    return isApi ? undefined : withCsp(req);
  }

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

  return isApi ? undefined : withCsp(req);
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files...
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)',
    // ...and always on API routes.
    '/(api|trpc)(.*)',
  ],
};
