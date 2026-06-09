import { PrismaClient } from '@prisma/client';

// Single Prisma Client for the whole app, connected as `app_user` (DATABASE_URL).
// Cached on globalThis to survive Next.js dev hot-reloads.
//
// IMPORTANT: never run tenant-scoped queries directly on this client. Tenant data
// must always go through withTenant() (src/lib/tenant.ts), which opens a
// transaction and binds `app.current_org`. A bare query here sees ZERO tenant
// rows because RLS fails closed when no org context is set — that is by design.
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
