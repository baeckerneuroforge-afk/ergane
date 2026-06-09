import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { isUuid } from './uuid';

/** The transaction-scoped client handed to every tenant operation. */
export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` inside a tenant-scoped transaction.
 *
 * This is the ONLY sanctioned way to touch tenant data. It:
 *   1. validates `orgId` is a real UUID (fail fast, before the DB),
 *   2. opens a Prisma *interactive* transaction (one pinned connection),
 *   3. as its FIRST statement binds `app.current_org` for this transaction only,
 *   4. runs `fn(tx)` — every query on `tx` is now filtered by RLS to this org.
 *
 * Why set_config(key, value, is_local := true) instead of `SET LOCAL key = …`?
 *   - `is_local = true` makes the setting transaction-scoped (exactly like
 *     SET LOCAL), so it is automatically cleared at COMMIT/ROLLBACK and never
 *     leaks onto the next user of a pooled connection.
 *   - Unlike `SET LOCAL`, set_config accepts a *bind parameter*, so the orgId is
 *     never string-interpolated into SQL → no injection surface (and we already
 *     validated it is a UUID).
 *
 * Pooling note: because the binding is transaction-local and lives inside a
 * single interactive transaction, this is also correct behind a transaction-mode
 * pooler (e.g. PgBouncer): the whole transaction runs on one pinned backend and
 * the GUC is reset when it ends. For local dev we connect directly (no pooler).
 */
export async function withTenant<T>(
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!orgId) {
    throw new Error(
      'withTenant: refusing to run a tenant query without an org context (orgId was empty).',
    );
  }
  if (!isUuid(orgId)) {
    throw new Error(`withTenant: orgId must be a valid UUID, received: ${JSON.stringify(orgId)}`);
  }

  return prisma.$transaction(
    async (tx) => {
      // MUST be the first statement in the transaction.
      await tx.$queryRaw`SELECT set_config('app.current_org', ${orgId}, true)`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}
