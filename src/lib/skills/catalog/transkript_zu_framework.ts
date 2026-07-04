// Skill: transkript_zu_framework — aus bereits ingestierten TRANSKRIPTEN ein
// strukturiertes Framework (Markdown) entwerfen und (NACH menschlicher Freigabe)
// als finales Deliverable ausgeben.
//
// DER ERSTE GENERATIVE SKILL. Bisher ist die Engine bewusst deterministisch;
// dies ist der erste Skill, der ein LLM aufruft. Er ist die Vergrößerung des
// angebot_erstellen-Musters (Kontext aus der Wissensbasis → Entwurf → Freigabe
// → finale Ausgabe), nur dass der Entwurf jetzt GENERATIV ist.
//
// DIE NICHT VERHANDELBARE REGEL (src/lib/tenant.ts:47-54 — 15s-Tx-Timeout):
// Der LLM-Call läuft NIEMALS in einer withTenant-Transaktion. Er läuft im
// prepare()-Hook des generativen Steps — VOR der Transaktion, Tx-frei (kein
// ctx.tx) — exakt wie answerQuestion (src/lib/rag/answer.ts): teurer Call
// zuerst, dann schreibt eine kurze Transaktion nur das Ergebnis atomar. Ein
// LLM-Schritt (30-60s) in der Tx würde sie sprengen UND unter Last den
// Connection-Pool erschöpfen — was auch die laufenden kurzen Skills träfe.
//
// Human-in-the-Loop: der finale Ausgabe-Step ist acts:true mit einer Guardrail,
// die IMMER triggert (wie angebot_erstellen) — ein neuer generativer Output
// wird nie ohne menschliche Freigabe finalisiert. Der bestehende
// Slack-Freigabe-Round-Trip (request-übergreifender Resume) trägt das
// automatisch.
//
// Disclosure/Isolation: der Kontext kommt rollenbewusst über holeWissen (Rolle
// des Auslösers aus dem Input, fail-closed) und ist per RLS auf den eigenen
// Mandanten beschränkt — der Skill sieht nur eigene, für die Rolle sichtbare
// Transkripte.
//
// Sprache: das Framework folgt der ORG-Locale (org_settings.locale, default
// 'en') — es ist ein kundenorientiertes Deliverable, keine UI. Die Locale wird
// im read-only Kontext-Step gelesen (dort gibt es eine Tx) und über den State an
// prepare() gereicht, damit der LLM-Prompt sprachrichtig ist OHNE dass prepare
// eine Transaktion öffnen müsste.
import { getChatProvider, type ChatProvider } from '../../ai';
import { getOrgLocale } from '../../i18n/org';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../i18n';
import type { SkillDef, SkillJson } from '../types';
import { holeWissen, rolleAusInput, type WissensTreffer } from './wissen';

export const FRAMEWORK_GUARDRAIL_REASON =
  'Generative deliverable — a newly authored framework, human approval required before it is finalized';

/** Anzahl Transkript-Passagen, die als Kontext in den Entwurf gehen. */
const CONTEXT_K = 8;

interface FrameworkInput {
  /** Worum es geht — steuert das Retrieval über die Transkripte. */
  thema: string;
  /** Optionaler Fokus/Ziel des Frameworks, z. B. "Beratungs-Framework"
   *  oder "Produkteinführung". Leer ⇒ ein allgemeines Framework. */
  fokus: string;
}

function parseInput(input: SkillJson): FrameworkInput {
  const thema = typeof input.thema === 'string' ? input.thema.trim() : '';
  const fokus = typeof input.fokus === 'string' ? input.fokus.trim() : '';
  if (!thema) throw new Error('transkript_zu_framework: input.thema is required.');
  return { thema, fokus };
}

/** Locale defensiv aus dem State (vom Kontext-Step gesetzt) — unbekannt ⇒ 'en'. */
function localeAusState(state: Record<string, SkillJson>): Locale {
  const value = state.transkript_kontext?.locale;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Kundenorientierte Rahmung pro Dokumentsprache (Org-Locale). Nur die feste
 *  Rahmung ist übersetzt; der generative Inhalt kommt in der Sprache des
 *  Kontexts vom Modell. */
const TEXTS: Record<Locale, {
  frameworkFor: (thema: string) => string;
  focusLine: (fokus: string) => string;
  generalFocus: string;
  noContext: (thema: string) => string;
  sourcesLabel: string;
  systemPrompt: string;
}> = {
  en: {
    frameworkFor: (thema) => `Framework: ${thema}`,
    focusLine: (fokus) => `Focus: ${fokus}`,
    generalFocus: 'general working framework',
    noContext: (thema) =>
      `No transcript content is available for "${thema}" — no framework can be grounded yet.`,
    sourcesLabel: 'Sources',
    systemPrompt:
      'You design a clear, structured working framework from the transcript excerpts of this organization.\n\n' +
      'Return GitHub-flavored Markdown with these sections, each as a "## " heading: ' +
      '"Situation" (the starting point), "Key themes" (the recurring themes across the transcripts), ' +
      'and "Recommendations / use cases" (at least three concrete, numbered items). ' +
      'Open with a one-paragraph executive summary BEFORE the first heading.\n\n' +
      'Use ONLY the supplied transcript excerpts. Each excerpt is prefixed with its source title in [brackets]. ' +
      'Do not invent facts. Do not add your own sources list — the system appends it. Answer in English.',
  },
  de: {
    frameworkFor: (thema) => `Framework: ${thema}`,
    focusLine: (fokus) => `Fokus: ${fokus}`,
    generalFocus: 'allgemeines Arbeits-Framework',
    noContext: (thema) =>
      `Kein Transkript-Inhalt zu „${thema}" verfügbar — es kann noch kein Framework fundiert werden.`,
    sourcesLabel: 'Quellen',
    systemPrompt:
      'Du entwirfst aus den Transkript-Auszügen dieser Organisation ein klares, strukturiertes Arbeits-Framework.\n\n' +
      'Gib GitHub-Flavored Markdown mit diesen Abschnitten zurück, jeder als "## "-Überschrift: ' +
      '„Ausgangslage" (der Ausgangspunkt), „Kernthemen" (die wiederkehrenden Themen über die Transkripte) ' +
      'und „Empfehlungen / Use Cases" (mindestens drei konkrete, nummerierte Punkte). ' +
      'Beginne mit einem Executive Summary von einem Absatz VOR der ersten Überschrift.\n\n' +
      'Nutze AUSSCHLIESSLICH die gelieferten Transkript-Auszüge. Jeder Auszug trägt seinen Quell-Titel in [eckigen Klammern]. ' +
      'Erfinde keine Fakten. Füge keine eigene Quellenliste an — das System hängt sie an. Antworte auf Deutsch.',
  },
};

/** User-Nachricht: Thema/Fokus + Transkript-Passagen als Kontextblock (dasselbe
 *  [Titel]-Präfix-Schema wie answerQuestion). */
function buildUserMessage(
  locale: Locale,
  thema: string,
  fokus: string,
  treffer: WissensTreffer[],
): string {
  const t = TEXTS[locale];
  const context = treffer.map((tr) => `[${tr.titel}] ${tr.auszug}`).join('\n\n');
  const focusText = fokus || t.generalFocus;
  return locale === 'de'
    ? `Thema: ${thema}\nGewünschtes Framework: ${focusText}\n\nTranskript-Auszüge:\n\n${context}`
    : `Topic: ${thema}\nDesired framework: ${focusText}\n\nTranscript excerpts:\n\n${context}`;
}

export const transkriptZuFramework: SkillDef = {
  key: 'transkript_zu_framework',
  title: 'Design a framework from transcripts',
  // Kein Geld im Spiel — aber die Freigabe kommt aus der finalen/externen
  // Wirkung des generativen Deliverables (wie angebot_erstellen): die Guardrail
  // triggert immer, der Default (keine Policy) ist damit stets Freigabe.
  handlesMoney: false,
  guardrail: () => ({ triggered: true, reason: FRAMEWORK_GUARDRAIL_REASON }),
  steps: [
    {
      // liest nur: rollenbewusstes Retrieval über die TRANSKRIPTE der
      // Wissensbasis. source='transcript' beschränkt den Kontext ehrlich auf
      // Transkript-Dokumente (fail-closed-Rollen-Disclosure wie überall). Liest
      // ausserdem die Org-Locale (hier ist eine Tx) und reicht sie über den
      // State an den generativen Step — damit prepare() KEINE Tx braucht.
      name: 'transkript_kontext',
      run: async ({ orgId, tx, input }) => {
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
        });
        return {
          thema,
          fokus: fokus || null,
          rolle: rolle || null,
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
      // GENERATIV: der LLM entwirft aus dem Transkript-Kontext ein
      // strukturiertes Framework (Markdown). Der teure Call läuft in prepare()
      // — VOR der Transaktion, Tx-frei — und wird von run() nur atomar
      // geschrieben. KEIN LLM in einer withTenant-Tx.
      name: 'framework_entworfen',
      // PRE-TX: hier läuft der LLM-Call. Kein ctx.tx ⇒ physisch außerhalb jeder
      // Transaktion (das ist der ganze Zweck des prepare-Hooks).
      prepare: async ({ input, state }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const treffer = (state.transkript_kontext?.treffer ?? []) as WissensTreffer[];
        // Ehrlichkeits-Regel wie answerQuestion: ohne Kontext KEIN LLM-Call.
        if (treffer.length === 0) {
          return { generiert: false, markdown: null };
        }
        const chat: ChatProvider = getChatProvider();
        const markdown = await chat.complete({
          system: TEXTS[locale].systemPrompt,
          messages: [{ role: 'user', content: buildUserMessage(locale, thema, fokus, treffer) }],
          maxTokens: 16000,
        });
        return { generiert: true, markdown: markdown.trim() };
      },
      // Atomarer Write des VORAB berechneten Ergebnisses — macht KEINEN
      // weiteren teuren Call, ergänzt nur die sprachrichtige Rahmung.
      run: async ({ input, state, prepared }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const treffer = (state.transkript_kontext?.treffer ?? []) as WissensTreffer[];
        const quellen = (state.transkript_kontext?.quellen ?? []) as string[];

        const generiert = prepared?.generiert === true;
        const markdown = typeof prepared?.markdown === 'string' ? prepared.markdown : null;

        if (!generiert || !markdown || treffer.length === 0) {
          // Ehrlich: kein Transkript-Kontext ⇒ kein fundiertes Framework.
          return { generiert: false, markdown: texts.noContext(thema), quellen: [] };
        }

        const kopf = [texts.frameworkFor(thema)];
        if (fokus) kopf.push(texts.focusLine(fokus));
        return { generiert: true, markdown, kopf: kopf.join('\n'), quellen };
      },
    },
    {
      // Der HANDELNDE Schritt: finale Ausgabe des Deliverables. Läuft erst NACH
      // menschlicher Freigabe (Guardrail triggert immer) — ein generativer
      // Output verlässt nie ungeprüft die Maschine.
      name: 'framework_ausgegeben',
      acts: true,
      // Probelauf-Vorschau (read-only): WAS ausgegeben würde, ohne finale Wirkung.
      describeEffect: ({ state }) => {
        const generiert = state.framework_entworfen?.generiert === true;
        const quellen = (state.framework_entworfen?.quellen ?? []) as string[];
        return {
          wirkung: generiert
            ? 'Would finalize and output the generated framework (Markdown) as the deliverable'
            : 'Would output the honest "no transcript context" note (nothing was generated)',
          wuerdeFramework: generiert,
          quellenAnzahl: quellen.length,
        };
      },
      run: async ({ state }) => {
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const generiert = state.framework_entworfen?.generiert === true;
        const markdown = String(state.framework_entworfen?.markdown ?? '');
        const kopf = typeof state.framework_entworfen?.kopf === 'string'
          ? state.framework_entworfen.kopf
          : '';
        const quellen = (state.framework_entworfen?.quellen ?? []) as string[];

        if (!generiert) {
          // Kein-Kontext-Fall: die ehrliche Notiz, keine Quellen-Zeile.
          return { ausgegeben: true, generiert: false, text: markdown, quellen: [] };
        }

        // Finales Deliverable: Kopf + Framework + kanonische Quellen-Zeile.
        const text = [kopf, '', markdown, '', `${texts.sourcesLabel}: ${quellen.join(', ')}`].join('\n');
        return { ausgegeben: true, generiert: true, text, quellen };
      },
    },
  ],
};
