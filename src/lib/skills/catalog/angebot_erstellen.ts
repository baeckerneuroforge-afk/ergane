// Skill: angebot_erstellen — Konditionen aus der Wissensbasis holen, Angebot
// entwerfen und (NACH menschlicher Freigabe) an den Kunden "versenden".
//
// Der Beweis für "Freigabe wegen EXTERNER WIRKUNG, nicht wegen Geld":
// handlesMoney ist false, aber die Guardrail triggert IMMER — ein Angebot
// verlässt das Unternehmen, unabhängig vom Betrag. Auch ein 1-€-Angebot
// pausiert in awaiting_approval. amountOf liefert den Betrag trotzdem, damit
// Threshold-Policies (Phase 4) ihn sehen, falls ein Tenant die Regel bewusst
// lockert — der Default (keine Policy) ist immer Freigabe.
//
// Versand (Phase 11): mit input.email geht das Angebot WIRKLICH raus — als
// PDF-Anhang über den Effekt-Provider (fake ohne RESEND_API_KEY, Resend mit).
// Ohne email bleibt der Versand simuliert (voriges Verhalten). In beiden
// Fällen läuft der Schritt erst NACH der menschlichen Freigabe.
import { getCompanyProfile } from '../../company';
import { formatEur, getEmailProvider, renderBusinessPdf } from '../../effects';
import type { SkillDef, SkillJson } from '../types';
import { holeWissen, rolleAusInput } from './wissen';

/** Optionale Empfänger-Adresse — nur ein plausibles a@b.c aktiviert den
 * echten Versand (fail-closed: alles andere ⇒ simuliert). */
export function emailAusInput(input: SkillJson): string | null {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const ANGEBOT_GUARDRAIL_REASON =
  'Externe Kommunikation — Angebot verlässt das Unternehmen, Freigabe erforderlich';

interface AngebotInput {
  kunde: string;
  leistung: string;
  betragEur: number;
}

function parseInput(input: SkillJson): AngebotInput {
  const kunde = typeof input.kunde === 'string' ? input.kunde.trim() : '';
  const leistung = typeof input.leistung === 'string' ? input.leistung.trim() : '';
  const betragEur = typeof input.betragEur === 'number' ? input.betragEur : NaN;
  if (!kunde) throw new Error('angebot_erstellen: input.kunde is required.');
  if (!leistung) throw new Error('angebot_erstellen: input.leistung is required.');
  if (!Number.isFinite(betragEur) || betragEur <= 0) {
    throw new Error('angebot_erstellen: input.betragEur must be a positive number.');
  }
  return { kunde, leistung, betragEur };
}

export const angebotErstellen: SkillDef = {
  key: 'angebot_erstellen',
  title: 'Kundenangebot erstellen und versenden',
  handlesMoney: false,
  // IMMER triggern: der Grund ist die externe Wirkung, nicht der Betrag.
  guardrail: () => ({ triggered: true, reason: ANGEBOT_GUARDRAIL_REASON }),
  amountOf: (input) =>
    typeof input.betragEur === 'number' && Number.isFinite(input.betragEur)
      ? input.betragEur
      : null,
  steps: [
    {
      // liest nur: Preise/Konditionen rollenbewusst aus der Wissensbasis.
      name: 'konditionen_geholt',
      run: async ({ orgId, tx, input }) => {
        const { leistung } = parseInput(input);
        const rolle = rolleAusInput(input);
        const treffer = await holeWissen(tx, {
          orgId,
          frage: `Preise Konditionen Rabatt Zahlungsziel ${leistung}`,
          rolle,
          k: 3,
        });
        return {
          rolle: rolle || null,
          konditionen: treffer.map((t) => ({ titel: t.titel, auszug: t.auszug })),
          quellen: [...new Set(treffer.map((t) => t.titel))],
        };
      },
    },
    {
      // liest nur: Angebotsentwurf aus Input + gefundenen Konditionen.
      name: 'angebot_entworfen',
      run: async ({ input, state }) => {
        const { kunde, leistung, betragEur } = parseInput(input);
        const konditionsHinweise = (state.konditionen_geholt?.konditionen ?? []) as Array<{
          titel: string;
          auszug: string;
        }>;
        return {
          empfaenger: kunde,
          leistung,
          betragEur,
          entwurf: [
            `Angebot für ${kunde}`,
            `Leistung: ${leistung}`,
            `Angebotssumme: ${betragEur.toFixed(2)} EUR`,
            konditionsHinweise.length > 0
              ? `Konditionen laut Wissensbasis:\n${konditionsHinweise.map((k) => `- [${k.titel}] ${k.auszug}`).join('\n')}`
              : 'Konditionen: Standardkonditionen (kein spezifisches Wissen sichtbar).',
          ].join('\n'),
        };
      },
    },
    {
      // Der HANDELNDE Schritt: simulierter Versand an den Kunden — läuft erst
      // nach menschlicher Freigabe (Guardrail triggert immer).
      name: 'versendet',
      acts: true,
      run: async ({ orgId, tx, input, state }) => {
        const { kunde, leistung, betragEur } = parseInput(input);
        const email = emailAusInput(input);
        if (!email) {
          return {
            versendet: true,
            empfaenger: kunde,
            betragEur,
            simuliert: true, // keine Empfänger-Adresse ⇒ kein echter Versand
          };
        }

        // Firmendaten aus den Einstellungen → Briefkopf/Fußzeile. Leeres
        // Profil ⇒ neutrales PDF, nichts wird erfunden.
        const firma = await getCompanyProfile(tx, orgId);
        const entwurf = typeof state.angebot_entworfen?.entwurf === 'string'
          ? state.angebot_entworfen.entwurf
          : `Angebot für ${kunde}`;
        const konditionen = entwurf
          .split('\n')
          .filter((z) => z.startsWith('Konditionen') || z.startsWith('- ['));
        const pdf = renderBusinessPdf({
          title: 'Angebot',
          sender: firma,
          recipient: [kunde],
          meta: [['Datum', new Date().toLocaleDateString('de-DE')]],
          body: [
            'Sehr geehrte Damen und Herren,',
            'gerne unterbreiten wir Ihnen das folgende Angebot:',
          ],
          positions: [{ beschreibung: leistung, betragEur }],
          totalLabel: 'Angebotssumme',
          closing: [
            ...konditionen,
            'Wir freuen uns auf Ihre Rückmeldung.',
            `Mit freundlichen Grüßen${firma.name ? `\n${firma.name}` : ''}`,
          ],
        });
        const result = await getEmailProvider().send({
          to: email,
          subject: `Ihr Angebot über ${formatEur(betragEur)}`,
          text: `${entwurf}\n\nMit freundlichen Grüßen${firma.name ? `\n${firma.name}` : ''}`,
          attachment: { filename: 'angebot.pdf', content: pdf },
        });
        return {
          versendet: true,
          empfaenger: kunde,
          empfaengerEmail: email,
          betragEur,
          simuliert: false,
          emailId: result.id,
          emailProvider: result.provider,
          pdfBytes: pdf.length,
        };
      },
    },
  ],
};
