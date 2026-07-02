// Content-Security-Policy with per-request nonces (Phase 16).
//
// Rollout is TWO-STAGE by design:
//   default            → Content-Security-Policy-Report-Only (observe, never
//                        break anything; violations show up in the console /
//                        report tooling)
//   CSP_ENFORCE=true   → Content-Security-Policy (enforced)
// Ship report-only first, watch one deploy, then flip the env var — never
// ship a lax policy just to avoid breakage.
//
// The nonce travels via the request header `x-nonce` (Next.js reads the CSP
// header from the middleware-rewritten request and applies the nonce to its
// own inline runtime scripts). 'strict-dynamic' lets nonce-approved scripts
// (Next runtime, Clerk loader) load their legitimate children.
import { randomBytes } from 'node:crypto';

export function generateCspNonce(): string {
  return randomBytes(16).toString('base64');
}

/** Clerk needs its frontend API + assets; everything else stays 'self'. */
const CLERK_HOSTS = 'https://*.clerk.accounts.dev https://*.clerk.com';

export function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    // 'strict-dynamic': only the nonce bootstraps scripts; those may load
    // their children (Next chunks, Clerk). https: is the pre-CSP3 fallback.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    // Next/Clerk inject inline styles; hash/nonce coverage for styles is not
    // stable across versions — inline styles are the accepted trade-off here.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://img.clerk.com`,
    `font-src 'self' data:`,
    `connect-src 'self' ${CLERK_HOSTS}`,
    `frame-src ${CLERK_HOSTS}`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

export function cspHeaderName(): string {
  return process.env.CSP_ENFORCE === 'true'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';
}
