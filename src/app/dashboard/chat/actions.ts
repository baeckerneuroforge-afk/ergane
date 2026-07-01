'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth-context';
import { answerQuestion } from '@/lib/rag';

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

  const { orgId, userId } = await requireTenant();
  await answerQuestion({ orgId, actorId: userId, question });

  revalidatePath('/dashboard/chat');
}
