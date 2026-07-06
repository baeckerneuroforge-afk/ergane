/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the foundation strict and explicit.
  reactStrictMode: true,
  poweredByHeader: false,

  // External image domains for marketing site integration logos.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.jsdelivr.net' },
      { protocol: 'https', hostname: 'cdn.simpleicons.org' },
      { protocol: 'https', hostname: 'svgl.app' },
    ],
  },

  // Pin the workspace root: a stray lockfile in the home directory otherwise
  // makes Turbopack scan far too wide a tree.
  turbopack: {
    root: import.meta.dirname,
  },

  experimental: {
    // Client router cache: reuse a dynamic page for up to 30s when navigating
    // back and forth. Server actions bust this via revalidatePath, so
    // mutations still appear immediately — only pure navigation gets faster.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  // Baseline security headers on every response (Phase 12). A CSP is NOT set
  // here yet: Next's inline runtime needs nonces/hashes — introduce it via
  // middleware when the surface stabilizes, don't ship a lax one.
  // X-Frame-Options: DENY is production-only — local dev tooling (embedded
  // preview browsers) renders the app in an iframe; prod stays locked down.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          ...(isProd ? [{ key: 'X-Frame-Options', value: 'DENY' }] : []),
          // HSTS: force HTTPS for two years incl. subdomains (production only —
          // never send it in dev, where the app is served over plain http on
          // localhost and a cached HSTS entry would break local access). Vercel
          // terminates TLS, so the app is always HTTPS in prod.
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
