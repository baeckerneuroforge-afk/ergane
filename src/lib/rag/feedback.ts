// RAG feedback loop (Phase 18): 👍/👎 on assistant answers.
//
// Fail-closed voting rule: a person may rate ONLY assistant messages of their
// OWN conversation (chat history is per-actor since 0010 — rating foreign
// messages would leak their existence). Votes are changeable (upsert on the
// (org, message, actor) unique). Deliberately NOT audited — this is product
// telemetry, not a governance action; aggregates feed future retrieval
// tuning (re-ranking is a documented follow-up, decided on real data).
import { withTenant } from '../tenant';

export type FeedbackVerdict = 'up' | 'down';

export interface SubmitChatFeedbackInput {
  orgId: string;
  /** The voter — must be the actor the message belongs to. */
  actorId: string;
  messageId: string;
  verdict: FeedbackVerdict;
}

export async function submitChatFeedback(input: SubmitChatFeedbackInput): Promise<void> {
  if (input.verdict !== 'up' && input.verdict !== 'down') {
    throw new Error('submitChatFeedback: verdict must be "up" or "down".');
  }
  if (!input.actorId.trim()) throw new Error('submitChatFeedback: actorId is required.');

  await withTenant(input.orgId, async (tx) => {
    // RLS scopes the lookup; a foreign-tenant id is "not found".
    const message = await tx.chatMessage.findUniqueOrThrow({
      where: { id: input.messageId },
    });
    if (message.role !== 'assistant') {
      throw new Error('submitChatFeedback: only assistant answers can be rated.');
    }
    if (message.actorId !== input.actorId) {
      // Own-conversation rule (fail-closed; also covers pre-0010 NULL actors).
      throw new Error('submitChatFeedback: you can only rate answers of your own conversation.');
    }

    await tx.chatFeedback.upsert({
      where: {
        orgId_messageId_actorId: {
          orgId: input.orgId,
          messageId: input.messageId,
          actorId: input.actorId,
        },
      },
      create: {
        orgId: input.orgId,
        messageId: input.messageId,
        actorId: input.actorId,
        verdict: input.verdict,
      },
      update: { verdict: input.verdict },
    });
  });
}

export interface FeedbackStats {
  up: number;
  down: number;
}

/** Tenant-wide aggregate (counts only — no contents, no voters). */
export async function getFeedbackStats(orgId: string): Promise<FeedbackStats> {
  return withTenant(orgId, async (tx) => {
    const up = await tx.chatFeedback.count({ where: { verdict: 'up' } });
    const down = await tx.chatFeedback.count({ where: { verdict: 'down' } });
    return { up, down };
  });
}

/** The caller's own votes for a set of messages (to render active buttons). */
export async function getOwnFeedback(
  orgId: string,
  actorId: string,
  messageIds: string[],
): Promise<Record<string, FeedbackVerdict>> {
  if (messageIds.length === 0 || !actorId) return {};
  const rows = await withTenant(orgId, (tx) =>
    tx.chatFeedback.findMany({
      where: { actorId, messageId: { in: messageIds } },
    }),
  );
  return Object.fromEntries(rows.map((r) => [r.messageId, r.verdict as FeedbackVerdict]));
}
