'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { enforceChatRetention } from '@/lib/lifecycle';
import { answerQuestion, loadChatHistory, submitChatFeedback } from '@/lib/rag';
import { deferWork } from '@/lib/slack/defer';

/**
 * Ask the knowledge base a question (RAG).
 *
 * Trust boundary: the org comes ONLY from requireTenant(). answerQuestion()
 * retrieves tenant-scoped chunks, answers grounded-with-sources (or honestly
 * declines), persists both chat messages and writes the audit entry.
 */
export async function askQuestion(formData: FormData) {
  const question = String(formData.get('question') ?? '').trim();
  if (!question) throw new Error('Question is required.');
  if (question.length > 2000) throw new Error('Question too long (max 2000 characters).');

  // The asker's role gates which knowledge is retrievable (disclosure policy).
  const { orgId, userId, role } = await requireTenant();
  // Multi-turn: prior turns of THIS user only (per-actor history — see 0010).
  const history = await loadChatHistory(orgId, userId);
  await answerQuestion({ orgId, actorId: userId, question, role, history });

  // Opportunistic retention enforcement (org_settings), deferred + best-effort
  // — the same no-cron pattern as the Slack claim cleanup.
  deferWork(
    async () => {
      await enforceChatRetention(orgId);
    },
    { label: 'chat:retention' },
  );

  revalidatePath('/dashboard/chat');
}

/**
 * Rate an assistant answer 👍/👎 — only answers of the CALLER's own
 * conversation (enforced fail-closed in submitChatFeedback).
 */
export async function rateAnswer(formData: FormData) {
  const messageId = String(formData.get('messageId') ?? '').trim();
  const rawVerdict = String(formData.get('verdict') ?? '');
  if (!messageId) throw new Error('messageId ist erforderlich.');
  if (rawVerdict !== 'up' && rawVerdict !== 'down') throw new Error('Ungültige Bewertung.');

  const { orgId, userId } = await requireTenant();
  await submitChatFeedback({ orgId, actorId: userId, messageId, verdict: rawVerdict });

  revalidatePath('/dashboard/chat');
}
