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

/**
 * CANONICAL sources format. Every grounded answer ends with exactly one line
 *
 *     Quellen: <Titel1>, <Titel2>, …
 *
 * appended deterministically by THIS layer (never left to the LLM — the system
 * prompt forbids the model to emit its own source list, and any line it emits
 * anyway is stripped). The honest no-knowledge answer carries NO sources line.
 * chat_messages deliberately has no sources column (spec-fixed shape), so this
 * marked line is what persists the sources in the history; the chat UI — and
 * later the skill engine — parse it back via this marker.
 */
export const SOURCES_MARKER = 'Quellen:';

const SYSTEM_PROMPT = `You are the knowledge assistant of this organization's internal knowledge base.

Rules:
- Answer ONLY from the context passages provided in the user message. Each passage is prefixed with its source document title in [brackets].
- If the context does not contain the answer, reply exactly: "${NO_KNOWLEDGE_ANSWER}" — do not guess, do not use outside knowledge.
- Do NOT list or repeat your sources and do not add a "${SOURCES_MARKER}" line — the system appends the canonical sources line itself.
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
  /** Canonical answer text; grounded answers end with the `Quellen: …` line. */
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

/** Drop any sources line the model emitted despite the prompt — the canonical
 * line is appended below, exactly once. */
function stripModelSourceLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith(SOURCES_MARKER))
    .join('\n')
    .trim();
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
    const raw = await chat.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(question, relevant) }],
    });
    const cleaned = stripModelSourceLines(raw);
    if (cleaned.includes(NO_KNOWLEDGE_ANSWER)) {
      // The model itself concluded the context is insufficient: no sources line.
      answer = NO_KNOWLEDGE_ANSWER;
    } else {
      sources = [...new Set(relevant.map((c) => c.documentTitle))];
      answer = `${cleaned}\n\n${SOURCES_MARKER} ${sources.join(', ')}`;
    }
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
