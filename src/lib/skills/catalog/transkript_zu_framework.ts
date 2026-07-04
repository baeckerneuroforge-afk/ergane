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
import { createArtifact } from '../../artifacts';
import { getOrgLocale } from '../../i18n/org';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../i18n';
import { getClientHistory, type ClientHistory } from '../../memory/history';
import type { SkillDef, SkillJson } from '../types';
import { holeWissen, rolleAusInput, type WissensTreffer } from './wissen';

export const FRAMEWORK_GUARDRAIL_REASON =
  'Generative deliverable — a newly authored framework, human approval required before it is finalized';

/** Anzahl Transkript-Passagen, die als Kontext in den Entwurf gehen. */
const CONTEXT_K = 8;

// -----------------------------------------------------------------------------
// System-Prompts: die inhaltliche Substanz dieses Skills. Sie definieren eine
// professionelle, kundentaugliche Framework-Struktur und binden JEDE Aussage an
// den Transkript-Inhalt (die Soll-Quelle-1-Idee aus dem Bauplan, Teil G:
// „jede Kernaussage trägt eine Transkript-Quelle"). Der generative Inhalt
// antwortet in der SPRACHE DER TRANSKRIPTE — ein deutscher Discovery-Call ergibt
// ein deutsches Framework, kein englisches. Nur die feste Rahmung ist lokalisiert.
// -----------------------------------------------------------------------------

/** Die sechs Abschnitte, sprachneutral als Struktur-Rückgrat (für beide Prompts
 *  und die Tests: die Abschnittsnamen dürfen nur hier geändert werden). */
export { FRAMEWORK_SECTIONS } from './framework-sections';

const SYSTEM_PROMPT_EN = [
  'You are a senior consultant. From the transcript excerpts of client conversations below, you write a crisp,',
  'client-ready working framework in GitHub-flavored Markdown — the kind of document a consultant would put in',
  'front of a client and their CFO.',
  '',
  'STRUCTURE — use exactly these sections, each as a "## " heading, in this order. Do NOT add your own title or "# " top-level heading and do NOT repeat the topic as a heading — start directly with "## Executive summary":',
  '## Executive summary — one tight paragraph a CFO can read in 30 seconds: the situation, the biggest lever, and the proposed direction.',
  '## Situation — the starting point in the client\'s own terms: who is involved (name the roles/stakeholders that appear), and the concrete pain, with the numbers the transcript actually states.',
  '## Key themes & goals — the recurring themes across the conversations, and the success criteria the client named (turn stated targets into measurable goals; quote the figure the transcript gives).',
  '## Constraints — the hard technical and organizational boundaries raised in the transcripts (e.g. system-access limits, data-handling rules, team/timeline/budget realities). Only what is actually stated.',
  '## Prioritized use cases — a numbered list of 3–5 concrete recommendations, most valuable first. For EACH: a bold title, one line on the value/impact (tie it to a pain or goal from the transcript), and a rough effort/sequencing note (pilot vs. rollout, timeframe) where the transcript supports it.',
  '## Next steps — 3–5 concrete, sequenced actions that move from this framework toward a decision.',
  '',
  'GROUNDING — this is non-negotiable:',
  '- Use ONLY the supplied transcript excerpts. Each excerpt is prefixed with its source title in [brackets].',
  '- Every claim must trace to something the transcript actually says. Do NOT invent numbers, names, dates, budgets, or commitments.',
  '- Prefer the client\'s concrete figures and phrasing over generic consulting language. If the transcript does not support a point, leave it out rather than fabricate.',
  '- Keep it tight and skimmable: short paragraphs, bullet/numbered lists, bold labels. No filler, no throat-clearing, no meta-commentary about being an AI.',
  '- Do NOT add your own "Sources" list — the system appends the canonical one.',
  '- Write the ENTIRE framework in the language of the transcripts.',
].join('\n');

const SYSTEM_PROMPT_DE = [
  'Du bist Senior-Beraterin bzw. Senior-Berater. Aus den unten stehenden Transkript-Auszügen von Kundengesprächen',
  'schreibst du ein prägnantes, kundentaugliches Arbeits-Framework in GitHub-Flavored Markdown — ein Dokument, das',
  'man einem Kunden und dessen Geschäftsführung/CFO direkt vorlegen kann.',
  '',
  'STRUKTUR — nutze exakt diese Abschnitte, jeder als "## "-Überschrift, in dieser Reihenfolge. Füge KEINEN eigenen Titel bzw. keine "# "-Überschrift der obersten Ebene ein und wiederhole NICHT das Thema als Überschrift — beginne direkt mit "## Executive Summary":',
  '## Executive Summary — ein knapper Absatz, den ein CFO in 30 Sekunden liest: die Ausgangslage, der größte Hebel und die vorgeschlagene Richtung.',
  '## Ausgangslage — der Ausgangspunkt in den Worten des Kunden: wer beteiligt ist (benenne die vorkommenden Rollen/Stakeholder) und der konkrete Schmerz, mit den Zahlen, die das Transkript tatsächlich nennt.',
  '## Kernthemen & Ziele — die wiederkehrenden Themen über die Gespräche hinweg und die vom Kunden genannten Erfolgskriterien (mach aus genannten Zielen messbare Zielwerte; greife die im Transkript genannte Kennzahl auf).',
  '## Rahmenbedingungen — die harten technischen und organisatorischen Grenzen aus den Transkripten (z. B. Zugriffsbeschränkungen auf Systeme, Datenschutz-/Datenhaltungs-Regeln, Team-/Zeit-/Budget-Realitäten). Nur was wirklich genannt wird.',
  '## Priorisierte Use Cases — eine nummerierte Liste von 3–5 konkreten Empfehlungen, das Wertvollste zuerst. Für JEDEN: ein fetter Titel, eine Zeile zum Nutzen/Impact (verknüpft mit einem Schmerz oder Ziel aus dem Transkript) und, wo das Transkript es hergibt, ein grober Aufwands-/Reihenfolge-Hinweis (Pilot vs. Rollout, Zeitrahmen).',
  '## Nächste Schritte — 3–5 konkrete, aufeinanderfolgende Handlungen, die von diesem Framework zu einer Entscheidung führen.',
  '',
  'FUNDIERUNG — nicht verhandelbar:',
  '- Nutze AUSSCHLIESSLICH die gelieferten Transkript-Auszüge. Jeder Auszug trägt seinen Quell-Titel in [eckigen Klammern].',
  '- Jede Aussage muss auf etwas zurückführbar sein, das im Transkript tatsächlich steht. Erfinde KEINE Zahlen, Namen, Daten, Budgets oder Zusagen.',
  '- Bevorzuge die konkreten Zahlen und Formulierungen des Kunden gegenüber generischer Berater-Sprache. Was das Transkript nicht hergibt, lässt du weg, statt es zu erfinden.',
  '- Halte es knapp und überfliegbar: kurze Absätze, Aufzählungen/Nummerierungen, fette Labels. Kein Fülltext, keine Einleitungsfloskeln, kein Meta-Kommentar über eine KI.',
  '- Füge KEINE eigene „Quellen"-Liste an — das System hängt die kanonische an.',
  '- Schreibe das GESAMTE Framework in der Sprache der Transkripte.',
].join('\n');

/** Timeout pro LLM-Versuch (ms). Ein hängender Netzwerk-Call (kein Fehler, keine
 *  Antwort) ist so schädlich wie ein Fehler: er blockiert den Deliverable-Lauf
 *  unbegrenzt. Ein hartes Zeitlimit macht daraus einen wiederholbaren Fehler.
 *  Grosszügig bemessen: ein grosses Framework mit adaptivem Thinking braucht real
 *  ~60s; das Limit liegt deutlich darüber, damit nur echte Hänger abbrechen und
 *  ein normal-langsamer Call nie fälschlich getötet wird. */
const LLM_ATTEMPT_TIMEOUT_MS = 180_000;

/** Kurzer Retry MIT Timeout für den generativen LLM-Call. Ein teurer
 *  Deliverable-Lauf darf nicht an einem einzelnen transienten Netzwerk-Blip
 *  scheitern oder an einem hängenden Call unbegrenzt festsitzen (beides in der
 *  Praxis beobachtet: sporadische "Connection error." bzw. stehende Verbindung
 *  beim großen Call, während der nächste Versuch sofort durchgeht). Läuft im
 *  prepare()-Hook — also OHNE offene Tx, die 15s-Regel bleibt unberührt. Kein
 *  Retry bei fachlicher Ablehnung (refusal): die ist deterministisch. */
async function completeWithRetry(
  chat: ChatProvider,
  req: Parameters<ChatProvider['complete']>[0],
  attempts = 3,
  timeoutMs = LLM_ATTEMPT_TIMEOUT_MS,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(chat.complete(req), timeoutMs);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Fachliche Ablehnung ist deterministisch → nicht wiederholen.
      if (/refus/i.test(msg)) break;
      // Kurzer, wachsender Backoff (0.5s, 1s) vor dem nächsten Versuch.
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Race einer Promise gegen ein Zeitlimit; nach Ablauf wirft sie (der Retry
 *  fängt das). Der zugrunde liegende Call läuft im Hintergrund weiter, aber sein
 *  (verspätetes) Ergebnis wird verworfen — akzeptabel für einen idempotenten
 *  Lese-/Generier-Call ohne Nebenwirkung. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`LLM call timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
 *  Rahmung (Kopf/Quellen-Label/Kein-Kontext-Notiz) ist an die Org-Locale
 *  gebunden; der GENERATIVE Inhalt kommt in der Sprache der Transkripte selbst
 *  (siehe systemPrompt — ein deutsches Transkript ergibt ein deutsches
 *  Framework, unabhängig von der UI-Sprache). */
const TEXTS: Record<Locale, {
  frameworkFor: (thema: string) => string;
  focusLine: (fokus: string) => string;
  generalFocus: string;
  noContext: (thema: string) => string;
  sourcesLabel: string;
  systemPrompt: string;
}> = {
  en: {
    frameworkFor: (thema) => `Framework — ${thema}`,
    focusLine: (fokus) => `**Focus:** ${fokus}`,
    generalFocus: 'a general engagement framework with prioritized use cases',
    noContext: (thema) =>
      `_No transcript content is available for "${thema}" yet — a grounded framework cannot be produced._`,
    sourcesLabel: 'Sources',
    systemPrompt: SYSTEM_PROMPT_EN,
  },
  de: {
    frameworkFor: (thema) => `Framework — ${thema}`,
    focusLine: (fokus) => `**Fokus:** ${fokus}`,
    generalFocus: 'ein allgemeines Einführungs-Framework mit priorisierten Use Cases',
    noContext: (thema) =>
      `_Zu „${thema}" liegt noch kein Transkript-Inhalt vor — ein fundiertes Framework ist noch nicht möglich._`,
    sourcesLabel: 'Quellen',
    systemPrompt: SYSTEM_PROMPT_DE,
  },
};

function buildHistoryBlock(history: ClientHistory, locale: Locale): string {
  const parts: string[] = [];
  if (locale === 'de') {
    parts.push(`=== FRÜHERE ARBEIT MIT DIESEM KUNDEN (${history.clientName}) ===`);
    if (history.notes) parts.push(`Kunden-Notiz: ${history.notes}`);
    if (history.runs.length > 0) {
      parts.push('', 'Bisherige Läufe:');
      for (const r of history.runs) {
        parts.push(`- ${r.skillKey} (${r.status}, ${r.createdAt.toISOString().slice(0, 10)})`);
      }
    }
    if (history.deliverables.length > 0) {
      parts.push('', 'Bisherige Deliverables (jeweils neueste Version):');
      for (const d of history.deliverables) {
        parts.push(`--- ${d.title} (Typ: ${d.type}, Version ${d.version}) ---`);
        if (d.content) parts.push(d.content);
        else parts.push('[Inhalt nicht verfügbar]');
      }
    }
    parts.push('=== ENDE FRÜHERE ARBEIT ===');
    parts.push('', 'Baue auf dieser früheren Arbeit auf: vermeide Widersprüche, zeige Fortschritt, wiederhole nicht, was bereits erarbeitet wurde.');
  } else {
    parts.push(`=== PRIOR WORK WITH THIS CLIENT (${history.clientName}) ===`);
    if (history.notes) parts.push(`Client note: ${history.notes}`);
    if (history.runs.length > 0) {
      parts.push('', 'Previous runs:');
      for (const r of history.runs) {
        parts.push(`- ${r.skillKey} (${r.status}, ${r.createdAt.toISOString().slice(0, 10)})`);
      }
    }
    if (history.deliverables.length > 0) {
      parts.push('', 'Previous deliverables (latest version each):');
      for (const d of history.deliverables) {
        parts.push(`--- ${d.title} (type: ${d.type}, version ${d.version}) ---`);
        if (d.content) parts.push(d.content);
        else parts.push('[Content unavailable]');
      }
    }
    parts.push('=== END PRIOR WORK ===');
    parts.push('', 'Build on this prior work: avoid contradictions, show progress, do not repeat what has already been produced.');
  }
  return parts.join('\n');
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
        `Auftrag: Erstelle das Framework zum Thema „${thema}".`,
        `Art des Frameworks: ${focusText}.`,
        '',
        'Stütze jede Aussage auf die folgenden Transkript-Auszüge (nur diese):',
        '',
        '=== TRANSKRIPT-AUSZÜGE ===',
        context,
        '=== ENDE DER AUSZÜGE ===',
      ].join('\n')
    : [
        `Task: Produce the framework on the topic "${thema}".`,
        `Type of framework: ${focusText}.`,
        '',
        'Ground every claim in the following transcript excerpts (these only):',
        '',
        '=== TRANSCRIPT EXCERPTS ===',
        context,
        '=== END OF EXCERPTS ===',
      ].join('\n');
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
        // Read clientId from the run row so it's available to later steps.
        const run = await tx.skillRun.findFirst({
          where: { orgId, skillKey: 'transkript_zu_framework', status: 'running' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, clientId: true },
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
      // GENERATIV: der LLM entwirft aus dem Transkript-Kontext ein
      // strukturiertes Framework (Markdown). Der teure Call läuft in prepare()
      // — VOR der Transaktion, Tx-frei — und wird von run() nur atomar
      // geschrieben. KEIN LLM in einer withTenant-Tx.
      name: 'framework_entworfen',
      // PRE-TX: hier läuft der LLM-Call. Kein ctx.tx ⇒ physisch außerhalb jeder
      // Transaktion (das ist der ganze Zweck des prepare-Hooks).
      prepare: async ({ orgId, input, state }) => {
        const { thema, fokus } = parseInput(input);
        const locale = localeAusState(state);
        const treffer = (state.transkript_kontext?.treffer ?? []) as WissensTreffer[];
        if (treffer.length === 0) {
          return { generiert: false, markdown: null };
        }

        const clientId = (state.transkript_kontext?.clientId as string) ?? null;
        let history: ClientHistory | null = null;
        if (clientId) {
          history = await getClientHistory(clientId, orgId);
          if (history.runs.length === 0 && history.deliverables.length === 0 && !history.notes) {
            history = null;
          }
        }

        const userMsg = history
          ? buildHistoryBlock(history, locale) + '\n\n' + buildUserMessage(locale, thema, fokus, treffer)
          : buildUserMessage(locale, thema, fokus, treffer);

        const chat: ChatProvider = getChatProvider();
        const markdown = await completeWithRetry(chat, {
          system: TEXTS[locale].systemPrompt,
          messages: [{ role: 'user', content: userMsg }],
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

        // Sauberer Markdown-Dokumentkopf: H1-Titel + optionale Fokus-Zeile.
        const kopf = [`# ${texts.frameworkFor(thema)}`];
        if (fokus) kopf.push('', texts.focusLine(fokus));
        return { generiert: true, markdown, kopf: kopf.join('\n'), quellen };
      },
    },
    {
      // Der HANDELNDE Schritt: finale Ausgabe des Deliverables. Läuft erst NACH
      // menschlicher Freigabe (Guardrail triggert immer) — ein generativer
      // Output verlässt nie ungeprüft die Maschine.
      //
      // ARTIFACT STORAGE: the blob-put (external network call) runs in prepare()
      // — BEFORE the withTenant transaction, exactly like the LLM call. The DB
      // row (artifact table) is written atomically inside run()'s transaction.
      name: 'framework_ausgegeben',
      acts: true,
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
      prepare: async ({ orgId, runId, input, state }) => {
        const { thema } = parseInput(input);
        const locale = localeAusState(state);
        const texts = TEXTS[locale];
        const generiert = state.framework_entworfen?.generiert === true;
        const markdown = String(state.framework_entworfen?.markdown ?? '');
        const kopf = typeof state.framework_entworfen?.kopf === 'string'
          ? state.framework_entworfen.kopf
          : '';
        const quellen = (state.framework_entworfen?.quellen ?? []) as string[];

        if (!generiert) {
          return { generiert: false, text: markdown, quellen: [] };
        }

        const fussnote = `_${texts.sourcesLabel}: ${quellen.join(', ')}_`;
        const text = [kopf, '', '---', '', markdown, '', '---', '', fussnote].join('\n');
        const bytes = new TextEncoder().encode(text);
        const clientId = (state.transkript_kontext?.clientId as string) ?? null;

        const artifact = await createArtifact({
          orgId,
          title: texts.frameworkFor(thema),
          type: 'framework',
          clientId,
          runId,
          bytes,
          contentType: 'text/markdown',
        });

        return { generiert: true, text, quellen, artifactId: artifact.id, version: artifact.version };
      },
      run: async ({ state, prepared }) => {
        const generiert = prepared?.generiert === true;
        const text = typeof prepared?.text === 'string' ? prepared.text : '';
        const quellen = Array.isArray(prepared?.quellen) ? (prepared.quellen as string[]) : [];
        const artifactId = typeof prepared?.artifactId === 'string' ? prepared.artifactId : null;
        const version = typeof prepared?.version === 'number' ? prepared.version : null;

        if (!generiert) {
          return { ausgegeben: true, generiert: false, text, quellen: [] };
        }

        return { ausgegeben: true, generiert: true, text, quellen, artifactId, version };
      },
    },
  ],
};
