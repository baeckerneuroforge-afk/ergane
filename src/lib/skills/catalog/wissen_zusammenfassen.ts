// Skill: wissen_zusammenfassen — eine Frage / ein Thema gegen die Wissensbasis
// beantworten und als strukturierte Zusammenfassung MIT Quellen ausgeben.
//
// READ-ONLY-Beweis für "ein Motor, viele Skills": alle Steps sind acts:false,
// handlesMoney:false, keine Guardrail — dieser Skill kann strukturell NIE eine
// Freigabe auslösen und läuft immer direkt bis completed.
//
// Disclosure gilt auch hier: das Retrieval läuft rollenbewusst (Rolle des
// Auslösers aus dem Input, fail-closed) — der Skill sieht nur, was die Rolle
// sehen darf. Kein sichtbares Wissen ⇒ die ehrliche Kein-Wissen-Antwort aus
// dem RAG-Layer, ohne Hinweis auf verborgene Dokumente (kein Leak).
//
// Die Zusammenfassung ist bewusst deterministisch (Struktur aus den Treffern,
// kein LLM-Call): Tests/Demo laufen offline, und in einer Step-Transaktion
// soll kein Chat-Modell hängen — dasselbe Muster wie die Kontierungs-Regeln
// in beleg_kontieren.
import { NO_KNOWLEDGE_ANSWER, SOURCES_MARKER } from '../../rag';
import { getOrgLocale } from '../../i18n/org';
import type { SkillDef, SkillJson } from '../types';
import { embedFrage, holeWissen, rolleAusInput, type WissensTreffer } from './wissen';

function parseInput(input: SkillJson): { frage: string } {
  const frage = typeof input.frage === 'string' ? input.frage.trim() : '';
  if (!frage) throw new Error('wissen_zusammenfassen: input.frage is required.');
  return { frage };
}

export const wissenZusammenfassen: SkillDef = {
  key: 'wissen_zusammenfassen',
  title: 'Summarize knowledge',
  handlesMoney: false,
  steps: [
    {
      // liest nur: rollenbewusstes Retrieval über die Wissensbasis.
      name: 'wissen_abgerufen',
      // F5: den Embedding-Netz-Call VOR der Transaktion machen (prepare, Tx-frei);
      // run() reicht den fertigen Vektor an holeWissen → nur die SQL läuft in der Tx.
      prepare: async ({ input }) => {
        const { frage } = parseInput(input);
        return { queryVector: await embedFrage(frage) };
      },
      run: async ({ orgId, tx, input, prepared }) => {
        const { frage } = parseInput(input);
        const rolle = rolleAusInput(input);
        const queryVector = prepared?.queryVector as number[] | undefined;
        const treffer = await holeWissen(tx, { orgId, frage, rolle, queryVector });
        return {
          frage,
          rolle: rolle || null,
          trefferAnzahl: treffer.length,
          treffer: treffer.map((t) => ({
            titel: t.titel,
            auszug: t.auszug,
            aehnlichkeit: Number(t.aehnlichkeit.toFixed(4)),
          })),
        };
      },
    },
    {
      // liest nur: strukturiert die Treffer zu einer Zusammenfassung.
      name: 'zusammenfassung_erstellt',
      run: async ({ orgId, tx, input, state }) => {
        const { frage } = parseInput(input);
        const locale = await getOrgLocale(tx, orgId);
        const treffer = (state.wissen_abgerufen?.treffer ?? []) as WissensTreffer[];
        if (treffer.length === 0) {
          // Ehrlich und leak-frei: exakt die kanonische Kein-Wissen-Antwort,
          // keine Quellen, kein Hinweis auf für die Rolle verborgene Dokumente.
          return { zusammenfassung: NO_KNOWLEDGE_ANSWER, quellen: [] };
        }
        const quellen = [...new Set(treffer.map((t) => t.titel))];
        const punkte = treffer.map((t) => `- [${t.titel}] ${t.auszug}`);
        return {
          zusammenfassung:
            locale === 'de'
              ? `Zusammenfassung zu „${frage}":\n${punkte.join('\n')}`
              : `Summary for "${frage}":\n${punkte.join('\n')}`,
          quellen,
        };
      },
    },
    {
      // liest nur: finale Ausgabe im kanonischen Quellen-Format des RAG-Layers.
      name: 'ausgegeben',
      run: async ({ state }) => {
        const zusammenfassung = String(state.zusammenfassung_erstellt?.zusammenfassung ?? '');
        const quellen = (state.zusammenfassung_erstellt?.quellen ?? []) as string[];
        const text =
          quellen.length > 0
            ? `${zusammenfassung}\n\n${SOURCES_MARKER} ${quellen.join(', ')}`
            : zusammenfassung; // Kein-Wissen-Antwort trägt KEINE Quellen-Zeile
        return { text, quellen };
      },
    },
  ],
};
