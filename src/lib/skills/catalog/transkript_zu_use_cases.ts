// Skill: transkript_zu_use_cases — second generative deliverable skill.
// From transcript knowledge, draft a prioritized use-case list (Markdown),
// pause for human approval, then persist as a versioned artifact (type: use_cases).
//
// Same architecture as transkript_zu_framework: LLM only in prepare() (no withTenant
// around the network call), acts:true final step with always-on guardrail.
import { getChatProvider, type ChatProvider } from '../../ai';
import { createArtifact } from '../../artifacts';
import { getOrgLocale } from '../../i18n/org';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../i18n';
import type { SkillDef, SkillJson } from '../types';
import { embedFrage, holeWissen, rolleAusInput, type WissensTreffer } from './wissen';

export const USE_CASES_GUARDRAIL_REASON =
  'Generative deliverable — newly authored use-case list, human approval required before finalization';

const CONTEXT_K = 8;
const LLM_ATTEMPT_TIMEOUT_MS = 180_000;

const SYSTEM_PROMPT_EN = [
  'You are a senior product consultant. From the transcript excerpts below, write a crisp,',
  'client-ready prioritized use-case list in GitHub-flavored Markdown.',
  '',
  'STRUCTURE — use exactly these sections as "## " headings in this order. Start with "## Executive summary":',
  '## Executive summary — 2–4 sentences: the opportunity and the recommendation direction.',
  '## Prioritized use cases — a numbered list of 3–5 use cases, most valuable first. For EACH: a **bold title**, one line of impact, and one line of effort/sequencing when the transcript supports it.',
  '## Risks & open questions — short bullets of uncertainties the transcripts raise.',
  '## Next steps — 3 concrete actions to decide and start.',
  '',
  'GROUNDING — non-negotiable:',
  '- Use ONLY the supplied transcript excerpts. Each is prefixed with its source title in [brackets].',
  '- Do NOT invent numbers, names, budgets, or commitments.',
  '- Do NOT add your own Sources list — the system appends one.',
  '- Write in the language of the transcripts.',
].join('\n');

const SYSTEM_PROMPT_DE = [
  'Du bist Senior Product Consultant. Aus den Transkript-Auszügen unten schreibst du eine knappe,',
  'kundentaugliche priorisierte Use-Case-Liste in GitHub-Flavored Markdown.',
  '',
  'STRUKTUR — exakt diese Abschnitte als "## "-Überschriften, in dieser Reihenfolge. Beginne mit "## Executive Summary":',
  '## Executive Summary — 2–4 Sätze: die Chance und die empfohlene Richtung.',
  '## Priorisierte Use Cases — nummerierte Liste von 3–5 Use Cases, Wertvollstes zuerst. Für JEDEN: **fetter Titel**, eine Zeile Impact, eine Zeile Aufwand/Reihenfolge wenn das Transkript es hergibt.',
  '## Risiken & offene Fragen — kurze Bullets zu Unsicherheiten aus den Transkripten.',
  '## Nächste Schritte — 3 konkrete Handlungen bis zur Entscheidung.',
  '',
  'FUNDIERUNG — nicht verhandelbar:',
  '- Nutze AUSSCHLIESSLICH die gelieferten Auszüge (Quelltitel in [Klammern]).',
  '- Erfinde KEINE Zahlen, Namen, Budgets oder Zusagen.',
  '- Keine eigene Quellen-Liste — das System hängt sie an.',
  '- Schreibe in der Sprache der Transkripte.',
].join('\n');

const TEXTS = {
  en: {
    titleFor: (thema: string) => `Use cases — ${thema}`,
    focusLine: (fokus: string) => `**Focus:** ${fokus}`,
    generalFocus: 'prioritized product/ops use cases from discovery conversations',
    noContext: (thema: string) =>
      `_No transcript content is available for "${thema}" yet — a grounded use-case list cannot be produced._`,
    sourcesLabel: 'Sources',
    systemPrompt: SYSTEM_PROMPT_EN,
  },
  de: {
    titleFor: (thema: string) => `Use Cases — ${thema}`,
    focusLine: (fokus: string) => `**Fokus:** ${fokus}`,
    generalFocus: 'priorisierte Produkt-/Ops-Use-Cases aus Discovery-Gesprächen',
    noContext: (thema: string) =>
      `_Zu „${thema}" liegt noch kein Transkript-Inhalt vor — eine fundierte Use-Case-Liste ist noch nicht möglich._`,
    sourcesLabel: 'Quellen',
    systemPrompt: SYSTEM_PROMPT_DE,
  },
} as const;

function parseInput(input: SkillJson): { thema: string; fokus: string } {
  const thema = String(input.thema ?? input.topic ?? '').trim();
  if (!thema) throw new Error('transkript_zu_use_cases: thema/topic is required.');
  const fokus = String(input.fokus ?? input.focus ?? '').trim();
  return { thema, fokus };
}

function localeAusState(state: Record<string, SkillJson>): Locale {
  const raw = state.use_case_kontext?.locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function completeWithRetry(
  chat: ChatProvider,
  req: { system: string; messages: Array<{ role: 'user'; content: string }>; maxTokens: number },
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await Promise.race([
        chat.complete(req),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM attempt timed out')), LLM_ATTEMPT_TIMEOUT_MS),
        ),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/refus/i.test(msg)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function buildUserMessage(
  locale: Locale,
  thema: string,
  fokus: string,
  treffer: WissensTreffer[],
): string {
  const t = TEXTS[locale];
  const context = treffer.map((tr) => `[${tr.titel}]\n${tr.auszug}`).join('\n\n---\n\n');
  const focusText = fokus || t.generalFocus;
  return locale === 'de'
    ? [
        `Auftrag: Erstelle die Use-Case-Liste zum Thema „${thema}".`,
        `Fokus: ${focusText}.`,
        '',
        'Stütze jede Aussage auf die folgenden Transkript-Auszüge:',
        '=== TRANSKRIPT-AUSZÜGE ===',
        context,
        '=== ENDE ===',
      ].join('\n')
    : [
        `Task: Produce the use-case list on the topic "${thema}".`,
        `Focus: ${focusText}.`,
        '',
        'Ground every claim in the following transcript excerpts:',
        '=== TRANSCRIPT EXCERPTS ===',
        context,
        '=== END ===',
      ].join('\n');
}

export const transkriptZuUseCases: SkillDef = {
  key: 'transkript_zu_use_cases',
  title: 'Prioritize use cases from transcripts',
  handlesMoney: false,
  requiresHumanApproval: true,
  guardrail: () => ({ triggered: true, reason: USE_CASES_GUARDRAIL_REASON }),
  steps: [
    {
      name: 'use_case_kontext',
      prepare: async ({ input }) => {
        const { thema, fokus } = parseInput(input);
        const frage = fokus ? `${thema} ${fokus}` : thema;
        return { queryVector: await embedFrage(frage) };
      },
      run: async ({ orgId, tx, input, prepared }) => {
        const { thema, fokus } = parseInput(input);
        const rolle = rolleAusInput(input);
        const locale = await getOrgLocale(tx, orgId);
        const frage = fokus ? `${thema} ${fokus}` : thema;
        const treffer = await holeWissen(tx, {
          orgId,
          frage,
          rolle,
          k: CONTEXT_K,
          source: 'transcript',
          queryVector: prepared?.queryVector as number[] | undefined,
        });
        const run = await tx.skillRun.findFirst({
          where: { orgId, skillKey: 'transkript_zu_use_cases', status: 'running' },
          orderBy: { createdAt: 'desc' },
          select: { clientId: true },
        });
        return {
          thema,
          fokus: fokus || null,
          rolle: rolle || null,
          locale,
          clientId: run?.clientId ?? null,
          trefferAnzahl: treffer.length,
          treffer: treffer.map((tr) => ({
            titel: tr.titel,
            auszug: tr.auszug,
            aehnlichkeit: Number(tr.aehnlichkeit.toFixed(4)),
          })),
          quellen: [...new Set(treffer.map((tr) => tr.titel))],
        };
      },
    },
    {
      name: 'use_cases_entworfen',
      prepare: async ({ input, state }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const treffer = (state.use_case_kontext?.treffer ?? []) as WissensTreffer[];
        if (treffer.length === 0) {
          return { generiert: false, markdown: null };
        }
        const chat = getChatProvider();
        const markdown = await completeWithRetry(chat, {
          system: TEXTS[locale].systemPrompt,
          messages: [{ role: 'user', content: buildUserMessage(locale, thema, fokus, treffer) }],
          maxTokens: 8000,
        });
        return { generiert: true, markdown: markdown.trim() };
      },
      run: async ({ input, state, prepared }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const treffer = (state.use_case_kontext?.treffer ?? []) as WissensTreffer[];
        const quellen = (state.use_case_kontext?.quellen ?? []) as string[];
        const generiert = prepared?.generiert === true;
        const markdown = typeof prepared?.markdown === 'string' ? prepared.markdown : null;

        if (!generiert || !markdown || treffer.length === 0) {
          return { generiert: false, markdown: texts.noContext(thema), quellen: [] };
        }

        const kopf = [`# ${texts.titleFor(thema)}`];
        if (fokus) kopf.push('', texts.focusLine(fokus));
        return { generiert: true, markdown, kopf: kopf.join('\n'), quellen };
      },
    },
    {
      name: 'use_cases_ausgegeben',
      acts: true,
      describeEffect: ({ state }) => {
        const generiert = state.use_cases_entworfen?.generiert === true;
        return {
          wirkung: generiert
            ? 'Would finalize and output the generated use-case list (Markdown) as a deliverable'
            : 'Would output the honest "no transcript context" note',
          wuerdeUseCases: generiert,
        };
      },
      prepare: async ({ orgId, runId, input, state }) => {
        const { thema } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const generiert = state.use_cases_entworfen?.generiert === true;
        const markdown = String(state.use_cases_entworfen?.markdown ?? '');
        const kopf =
          typeof state.use_cases_entworfen?.kopf === 'string'
            ? state.use_cases_entworfen.kopf
            : '';
        const quellen = (state.use_cases_entworfen?.quellen ?? []) as string[];

        if (!generiert) {
          return { generiert: false, text: markdown, quellen: [] };
        }

        const fussnote = `_${texts.sourcesLabel}: ${quellen.join(', ')}_`;
        const text = [kopf, '', '---', '', markdown, '', '---', '', fussnote].join('\n');
        const bytes = new TextEncoder().encode(text);
        const clientId = (state.use_case_kontext?.clientId as string) ?? null;

        const artifact = await createArtifact({
          orgId,
          title: texts.titleFor(thema),
          type: 'use_cases',
          clientId,
          runId,
          bytes,
          contentType: 'text/markdown',
        });

        return {
          generiert: true,
          text,
          quellen,
          artifactId: artifact.id,
          version: artifact.version,
        };
      },
      run: async ({ prepared }) => {
        const generiert = prepared?.generiert === true;
        const text = typeof prepared?.text === 'string' ? prepared.text : '';
        const quellen = Array.isArray(prepared?.quellen) ? (prepared.quellen as string[]) : [];
        const artifactId = typeof prepared?.artifactId === 'string' ? prepared.artifactId : null;
        const version = typeof prepared?.version === 'number' ? prepared.version : null;
        if (!generiert) {
          return { ausgegeben: true, generiert: false, text, quellen: [], type: 'use_cases' };
        }
        return {
          ausgegeben: true,
          generiert: true,
          text,
          quellen,
          artifactId,
          version,
          type: 'use_cases',
        };
      },
    },
  ],
};
