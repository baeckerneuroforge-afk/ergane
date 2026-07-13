import { PrismaClient } from '@prisma/client';

// Single Prisma Client for the whole app, connected as `app_user` (DATABASE_URL).
// Cached on globalThis to survive Next.js dev hot-reloads.
//
// IMPORTANT: never run tenant-scoped queries directly on this client. Tenant data
// must always go through withTenant() (src/lib/tenant.ts), which opens a
// transaction and binds `app.current_org`. A bare query here sees ZERO tenant
// rows because RLS fails closed when no org context is set — that is by design.
//
// Serverless pooling (Vercel + Neon) — configure via DATABASE_URL query params,
// not client constructor options (keeps local Docker tests simple):
//   • POOLED Neon endpoint (transaction-mode PgBouncer)
//   • `pgbouncer=true` — Prisma disables named prepared statements
//   • `connection_limit=1` — one connection per serverless instance (tune up only
//     if the Neon plan and concurrent load justify it)
// Example:
//   postgresql://app_user:***@ep-….pooler.neon.tech/ergane?sslmode=require&pgbouncer=true&connection_limit=1
// Isolation is unchanged: withTenant() binds app.current_org with set_config
// (is_local=true) inside an interactive transaction. Migrations use
// DIRECT_DATABASE_URL (unpooled owner), never this client’s URL.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Non-secret diagnostic: does DATABASE_URL look serverless-pooled?
 * Used by ops checks / tests — never logs the full URL.
 */
export function databaseUrlPoolingHints(url = process.env.DATABASE_URL ?? ''): {
  hasPgbouncer: boolean;
  hasConnectionLimit: boolean;
  looksPooledHost: boolean;
} {
  let parsed: URL | null = null;
  try {
    parsed = url ? new URL(url) : null;
  } catch {
    parsed = null;
  }
  const params = parsed?.searchParams;
  const host = parsed?.hostname ?? '';
  return {
    hasPgbouncer: params?.get('pgbouncer') === 'true',
    hasConnectionLimit: Boolean(params?.get('connection_limit')),
    looksPooledHost: /pooler|pgbouncer/i.test(host),
  };
}
