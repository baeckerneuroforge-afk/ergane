import type { AuditLog, Prisma } from '@prisma/client';
import { withTenant, type Tx } from './tenant';

export type ActorType = 'human' | 'agent';

export interface AuditEntry {
  /**
   * The tenant this action belongs to. Passed explicitly as defense-in-depth:
   * RLS WITH CHECK will reject it anyway if it does not match the transaction's
   * `app.current_org`, but writing it out makes the intent unmistakable and the
   * failure mode loud.
   */
  orgId: string;
  /** Clerk user id, or an agent/service identifier. */
  actorId: string;
  actorType: ActorType;
  /** Machine-readable verb, e.g. "knowledge_item.create". */
  action: string;
  /** Optional id/path of the affected object. */
  target?: string | null;
  /** Optional structured payload, e.g. { old, new } for policy changes. */
  detail?: Record<string, unknown> | null;
}

/**
 * Append a row to the append-only audit trail. MUST be called with the same `tx`
 * (and therefore the same tenant context) as the action it records, so the audit
 * row lands in the same transaction as the change it describes.
 */
export async function logAudit(tx: Tx, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      actorType: entry.actorType,
      action: entry.action,
      target: entry.target ?? null,
      detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface AuditQuery {
  /** Filter: action prefix(es), e.g. ['skill.', 'approval.']. */
  actionPrefixes?: string[];
  /** Filter: exact actor id. */
  actorId?: string;
  /** 1-based page. */
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  entries: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated, filtered read of the tenant's audit trail (newest first) — used
 * by the audit UI. Runs entirely inside withTenant, so filters can never
 * widen the scope beyond the caller's tenant.
 */
export async function queryAuditLog(orgId: string, query: AuditQuery = {}): Promise<AuditPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(query.pageSize ?? 50)));

  const where: Prisma.AuditLogWhereInput = {
    ...(query.actionPrefixes && query.actionPrefixes.length > 0
      ? { OR: query.actionPrefixes.map((p) => ({ action: { startsWith: p } })) }
      : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
  };

  return withTenant(orgId, async (tx) => {
    // Sequential on purpose: concurrent queries on one interactive-transaction
    // client are unsupported (single pinned connection).
    const entries = await tx.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const total = await tx.auditLog.count({ where });
    return { entries, total, page, pageSize };
  });
}
