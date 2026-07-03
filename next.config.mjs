/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the foundation strict and explicit.
  reactStrictMode: true,
  poweredByHeader: false,

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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
