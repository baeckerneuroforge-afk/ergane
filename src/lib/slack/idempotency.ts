// Idempotency claims against Slack redeliveries.
//
// Slack redelivers a request when the 200 arrives late — and can, rarely,
// retry even after a fast ack. Every handler therefore CLAIMS the request's
// stable key before deferring any work:
//
//   events        → event_id            (fallback: team_id + event ts)
//   commands      → trigger_id
//   interactions  → trigger_id
//
// claimSlackEvent() is an atomic INSERT into slack_processed_events inside
// withTenant(orgId); the unique (org_id, event_key) makes the SECOND claim of
// the same key fail ⇒ false ⇒ the caller acks 200 and does nothing. Claims are
// per tenant: the same key in org A and org B never collide.
import { Prisma } from '@prisma/client';
import { withTenant } from '../tenant';

/**
 * Atomically claim `eventKey` for this org. true ⇒ first delivery, proceed.
 * false ⇒ already claimed (duplicate delivery), ack silently and stop.
 */
export async function claimSlackEvent(orgId: string, eventKey: string): Promise<boolean> {
  if (!eventKey.trim()) {
    throw new Error('claimSlackEvent: eventKey is required.');
  }
  try {
    await withTenant(orgId, (tx) =>
      tx.slackProcessedEvent.create({ data: { orgId, eventKey } }),
    );
    return true;
  } catch (err) {
    // P2002 = unique violation: the key was already claimed (duplicate).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}

/**
 * Remove claims older than `olderThanHours` (default 24 h — far beyond Slack's
 * retry horizon of minutes). Correctness never depends on cleanup; this only
 * keeps the table small. Call it from any maintenance path (admin action,
 * deploy hook, future cron) — deliberately no scheduler in this stack yet.
 */
export async function cleanupProcessedSlackEvents(
  orgId: string,
  olderThanHours = 24,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const { count } = await withTenant(orgId, (tx) =>
    tx.slackProcessedEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  );
  return count;
}
