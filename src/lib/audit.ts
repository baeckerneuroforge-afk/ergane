import type { Tx } from './tenant';

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
    },
  });
}
