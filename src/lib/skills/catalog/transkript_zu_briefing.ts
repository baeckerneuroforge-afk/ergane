// Skill: transkript_zu_briefing — short executive briefing Markdown from transcripts.
// P3-C third generative deliverable type ('briefing').
import { getChatProvider, type ChatProvider } from '../../ai';
import { createArtifact } from '../../artifacts';
import { getOrgLocale } from '../../i18n/org';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../i18n';
import type { SkillDef, SkillJson } from '../types';
import { embedFrage, holeWissen, rolleAusInput, type WissensTreffer } from './wissen';

export const BRIEFING_GUARDRAIL_REASON =
  'Generative deliverable — newly authored briefing, human approval required before finalization';

const CONTEXT_K = 6;
const LLM_ATTEMPT_TIMEOUT_MS = 120_000;

const SYSTEM_EN = [
  'You are a senior consultant. From the transcript excerpts, write a short executive briefing in GitHub-flavored Markdown.',
  'STRUCTURE — use exactly these "## " headings in order. Start with "## Executive summary":',
  '## Executive summary — 3–5 sentences a CEO can read in under a minute.',
  '## Key decisions needed — bullet list of decisions the client must make.',
  '## Risks — top risks grounded only in the transcripts.',
  '## Recommended next conversation — 2–3 questions to ask next.',
  'GROUNDING: use ONLY the excerpts. Do not invent numbers or commitments. No Sources list (system appends). Write in the language of the transcripts.',
].join('\n');

const SYSTEM_DE = [
  'Du bist Senior-Berater/in. Aus den Transkript-Auszügen schreibst du ein kurzes Executive Briefing in GitHub-Flavored Markdown.',
  'STRUKTUR — exakt diese "## "-Überschriften, Reihenfolge. Beginne mit "## Executive Summary":',
  '## Executive Summary — 3–5 Sätze, die eine Geschäftsführung in unter einer Minute liest.',
  '## Anstehende Entscheidungen — Bullet-Liste der Entscheidungen, die der Kunde treffen muss.',
  '## Risiken — Top-Risiken, nur aus den Transkripten.',
  '## Empfohlenes nächstes Gespräch — 2–3 Fragen für den nächsten Call.',
  'FUNDIERUNG: nur die Auszüge. Keine erfundenen Zahlen. Keine eigene Quellen-Liste. Sprache der Transkripte.',
].join('\n');

const TEXTS = {
  en: {
    titleFor: (t: string) => `Briefing — ${t}`,
    sourcesLabel: 'Sources',
    noContext: (t: string) =>
      `_No transcript content is available for "${t}" yet — a grounded briefing cannot be produced._`,
    system: SYSTEM_EN,
  },
  de: {
    titleFor: (t: string) => `Briefing — ${t}`,
    sourcesLabel: 'Quellen',
    noContext: (t: string) =>
      `_Zu „${t}" liegt noch kein Transkript vor — ein fundiertes Briefing ist noch nicht möglich._`,
    system: SYSTEM_DE,
  },
} as const;

function parseInput(input: SkillJson): { thema: string; fokus: string } {
  const thema = String(input.thema ?? input.topic ?? '').trim();
  if (!thema) throw new Error('transkript_zu_briefing: thema/topic is required.');
  const fokus = String(input.fokus ?? input.focus ?? '').trim();
  return { thema, fokus };
}

function localeAusState(state: Record<string, SkillJson>): Locale {
  const raw = state.briefing_kontext?.locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function completeWithRetry(
  chat: ChatProvider,
  req: { system: string; messages: Array<{ role: 'user'; content: string }>; maxTokens: number },
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await Promise.race([
        chat.complete(req),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM attempt timed out')), LLM_ATTEMPT_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /refus/i.test(err.message)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const transkriptZuBriefing: SkillDef = {
  key: 'transkript_zu_briefing',
  title: 'Write an executive briefing from transcripts',
  handlesMoney: false,
  requiresHumanApproval: true,
  guardrail: () => ({ triggered: true, reason: BRIEFING_GUARDRAIL_REASON }),
  steps: [
    {
      name: 'briefing_kontext',
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
        return {
          thema,
          fokus: fokus || null,
          locale,
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
      name: 'briefing_entworfen',
      prepare: async ({ input, state }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const treffer = (state.briefing_kontext?.treffer ?? []) as WissensTreffer[];
        if (treffer.length === 0) return { generiert: false, markdown: null };
        const context = treffer.map((tr) => `[${tr.titel}]\n${tr.auszug}`).join('\n\n---\n\n');
        const user =
          locale === 'de'
            ? `Auftrag: Briefing zu „${thema}"${fokus ? ` (Fokus: ${fokus})` : ''}.\n\n=== AUSZÜGE ===\n${context}\n=== ENDE ===`
            : `Task: Briefing on "${thema}"${fokus ? ` (focus: ${fokus})` : ''}.\n\n=== EXCERPTS ===\n${context}\n=== END ===`;
        const markdown = await completeWithRetry(getChatProvider(), {
          system: TEXTS[locale].system,
          messages: [{ role: 'user', content: user }],
          maxTokens: 4000,
        });
        return { generiert: true, markdown: markdown.trim() };
      },
      run: async ({ input, state, prepared }) => {
        const { thema } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const treffer = (state.briefing_kontext?.treffer ?? []) as WissensTreffer[];
        const quellen = (state.briefing_kontext?.quellen ?? []) as string[];
        const generiert = prepared?.generiert === true;
        const markdown = typeof prepared?.markdown === 'string' ? prepared.markdown : null;
        if (!generiert || !markdown || treffer.length === 0) {
          return { generiert: false, markdown: texts.noContext(thema), quellen: [] };
        }
        return {
          generiert: true,
          markdown,
          kopf: `# ${texts.titleFor(thema)}`,
          quellen,
        };
      },
    },
    {
      name: 'briefing_ausgegeben',
      acts: true,
      describeEffect: ({ state }) => ({
        wirkung:
          state.briefing_entworfen?.generiert === true
            ? 'Would finalize the executive briefing as a deliverable artifact'
            : 'Would output the honest no-context note',
      }),
      prepare: async ({ orgId, runId, input, state }) => {
        const { thema } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const generiert = state.briefing_entworfen?.generiert === true;
        const markdown = String(state.briefing_entworfen?.markdown ?? '');
        const kopf = String(state.briefing_entworfen?.kopf ?? '');
        const quellen = (state.briefing_entworfen?.quellen ?? []) as string[];
        if (!generiert) {
          return { generiert: false, text: markdown, quellen: [] };
        }
        const text = [
          kopf,
          '',
          '---',
          '',
          markdown,
          '',
          '---',
          '',
          `_${texts.sourcesLabel}: ${quellen.join(', ')}_`,
        ].join('\n');
        const artifact = await createArtifact({
          orgId,
          title: texts.titleFor(thema),
          type: 'briefing',
          clientId: null,
          runId,
          bytes: new TextEncoder().encode(text),
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
        return {
          ausgegeben: true,
          generiert,
          text: typeof prepared?.text === 'string' ? prepared.text : '',
          quellen: Array.isArray(prepared?.quellen) ? prepared.quellen : [],
          artifactId: typeof prepared?.artifactId === 'string' ? prepared.artifactId : null,
          version: typeof prepared?.version === 'number' ? prepared.version : null,
          type: 'briefing',
        };
      },
    },
  ],
};
