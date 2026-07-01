// RAG answering: question → retrieve → grounded LLM answer WITH sources.
//
// Honesty rule: if retrieval yields nothing above the embedder's relevance
// threshold, we do NOT call the LLM at all — we return the fixed "no verified
// knowledge" answer. The LLM is additionally instructed to use only the
// supplied context, so both layers guard against hallucinated answers.
//
// Persistence: the user question + assistant answer land in chat_messages and
// the audit entry in audit_log, all in ONE withTenant() transaction after the
// answer exists (an LLM call must never run inside an open DB transaction).
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from '../ai';
import { logAudit } from '../audit';
import { withTenant } from '../tenant';
import { retrieve, type RetrievedChunk } from './retrieve';

export const NO_KNOWLEDGE_ANSWER =
  'Dazu habe ich kein geprüftes Wissen in der Wissensbasis.';

const SYSTEM_PROMPT = `You are the knowledge assistant of this organization's internal knowledge base.

Rules:
- Answer ONLY from the context passages provided in the user message. Each passage is prefixed with its source document title in [brackets].
- If the context does not contain the answer, reply exactly: "${NO_KNOWLEDGE_ANSWER}" — do not guess, do not use outside knowledge.
- Answer in the language of the question, concisely.`;

export interface AnswerQuestionInput {
  orgId: string;
  actorId: string;
  question: string;
  k?: number;
  embedder?: EmbeddingProvider;
  chat?: ChatProvider;
}

export interface AnswerQuestionResult {
  answer: string;
  /** Unique document titles the answer is based on; empty for the honest "no knowledge" case. */
  sources: string[];
  /** The chunks that were used as context (for display/debugging). */
  usedChunks: RetrievedChunk[];
}

function buildUserMessage(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map((c) => `[${c.documentTitle}] ${c.content}`)
    .join('\n\n');
  return `Context passages:\n\n${context}\n\nQuestion: ${question}`;
}

export async function answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
  const question = input.question.trim();
  if (!question) throw new Error('answerQuestion: question is required.');

  const embedder = input.embedder ?? getEmbeddingProvider();
  const retrieved = await retrieve({
    orgId: input.orgId,
    query: question,
    k: input.k,
    embedder,
  });
  const relevant = retrieved.filter((c) => c.similarity >= embedder.relevanceThreshold);

  let answer: string;
  let sources: string[] = [];
  if (relevant.length === 0) {
    answer = NO_KNOWLEDGE_ANSWER;
  } else {
    const chat = input.chat ?? getChatProvider();
    answer = await chat.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(question, relevant) }],
    });
    // If the model itself concluded the context is insufficient, report no sources.
    sources = answer.includes(NO_KNOWLEDGE_ANSWER)
      ? []
      : [...new Set(relevant.map((c) => c.documentTitle))];
  }

  await withTenant(input.orgId, async (tx) => {
    await tx.chatMessage.create({
      data: { orgId: input.orgId, role: 'user', content: question },
    });
    await tx.chatMessage.create({
      data: { orgId: input.orgId, role: 'assistant', content: answer },
    });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorId,
      actorType: 'agent',
      action: 'chat.answered',
      target: question.slice(0, 120),
    });
  });

  return { answer, sources, usedChunks: relevant };
}
