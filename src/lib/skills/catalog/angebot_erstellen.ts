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
//
// Document language: draft, e-mail and PDF follow the ORG locale
// (org_settings.locale, default 'en') — customer-facing output, not the UI.
import { getCompanyProfile } from '../../company';
import { getOrgLocale } from '../../i18n/org';
import { formatEur, getEmailProvider, renderBusinessPdf, type PdfLocale } from '../../effects';
import type { SkillDef, SkillJson } from '../types';
import { holeWissen, rolleAusInput } from './wissen';

/** Optionale Empfänger-Adresse — nur ein plausibles a@b.c aktiviert den
 * echten Versand (fail-closed: alles andere ⇒ simuliert). */
export function emailAusInput(input: SkillJson): string | null {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const ANGEBOT_GUARDRAIL_REASON =
  'External communication — the quote leaves the company, approval required';

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

/** Customer-facing wording per document language (org locale). */
const TEXTS: Record<PdfLocale, {
  docTitle: string;
  draftFor: (kunde: string) => string;
  service: (leistung: string) => string;
  total: (amount: string) => string;
  conditionsFromKb: string;
  conditionsFallback: string;
  dateLabel: string;
  salutation: string;
  bodyIntro: string;
  totalLabel: string;
  lookingForward: string;
  regards: string;
  subject: (amount: string) => string;
  pdfFilename: string;
}> = {
  en: {
    docTitle: 'Quote',
    draftFor: (kunde) => `Quote for ${kunde}`,
    service: (leistung) => `Service: ${leistung}`,
    total: (amount) => `Quote total: ${amount} EUR`,
    conditionsFromKb: 'Terms according to the knowledge base:',
    conditionsFallback: 'Terms: standard terms (no specific knowledge visible).',
    dateLabel: 'Date',
    salutation: 'Dear Sir or Madam,',
    bodyIntro: 'We are pleased to submit the following quote:',
    totalLabel: 'Quote total',
    lookingForward: 'We look forward to hearing from you.',
    regards: 'Kind regards',
    subject: (amount) => `Your quote for ${amount}`,
    pdfFilename: 'quote.pdf',
  },
  de: {
    docTitle: 'Angebot',
    draftFor: (kunde) => `Angebot für ${kunde}`,
    service: (leistung) => `Leistung: ${leistung}`,
    total: (amount) => `Angebotssumme: ${amount} EUR`,
    conditionsFromKb: 'Konditionen laut Wissensbasis:',
    conditionsFallback: 'Konditionen: Standardkonditionen (kein spezifisches Wissen sichtbar).',
    dateLabel: 'Datum',
    salutation: 'Sehr geehrte Damen und Herren,',
    bodyIntro: 'gerne unterbreiten wir Ihnen das folgende Angebot:',
    totalLabel: 'Angebotssumme',
    lookingForward: 'Wir freuen uns auf Ihre Rückmeldung.',
    regards: 'Mit freundlichen Grüßen',
    subject: (amount) => `Ihr Angebot über ${amount}`,
    pdfFilename: 'angebot.pdf',
  },
};

export const angebotErstellen: SkillDef = {
  key: 'angebot_erstellen',
  title: 'Create and send a customer quote',
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
      run: async ({ orgId, tx, input, state }) => {
        const { kunde, leistung, betragEur } = parseInput(input);
        const locale = await getOrgLocale(tx, orgId);
        const texts = TEXTS[locale];
        const konditionsHinweise = (state.konditionen_geholt?.konditionen ?? []) as Array<{
          titel: string;
          auszug: string;
        }>;
        return {
          empfaenger: kunde,
          leistung,
          betragEur,
          entwurf: [
            texts.draftFor(kunde),
            texts.service(leistung),
            texts.total(betragEur.toFixed(2)),
            konditionsHinweise.length > 0
              ? `${texts.conditionsFromKb}\n${konditionsHinweise.map((k) => `- [${k.titel}] ${k.auszug}`).join('\n')}`
              : texts.conditionsFallback,
          ].join('\n'),
        };
      },
    },
    {
      // Der HANDELNDE Schritt: simulierter Versand an den Kunden — läuft erst
      // nach menschlicher Freigabe (Guardrail triggert immer).
      name: 'versendet',
      acts: true,
      // Probelauf-Vorschau (read-only): WAS versendet würde, ohne Versand.
      describeEffect: ({ input }) => {
        const email = emailAusInput(input);
        return {
          wirkung: email
            ? `Would send the quote by e-mail to ${email} (PDF attached)`
            : 'Would record a simulated send (no recipient e-mail provided)',
          empfaenger: typeof input.kunde === 'string' ? input.kunde : null,
          empfaengerEmail: email,
          betragEur: typeof input.betragEur === 'number' ? input.betragEur : null,
          wuerdeEchtVersenden: Boolean(email),
        };
      },
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
        // Profil ⇒ neutrales PDF, nichts wird erfunden. Sprache = Org-Locale.
        const locale = await getOrgLocale(tx, orgId);
        const texts = TEXTS[locale];
        const firma = await getCompanyProfile(tx, orgId);
        const entwurf = typeof state.angebot_entworfen?.entwurf === 'string'
          ? state.angebot_entworfen.entwurf
          : texts.draftFor(kunde);
        // Konditionen aus dem Retrieval-Step — nicht aus dem Entwurfstext
        // geparst (sprachunabhängig).
        const konditionsHinweise = (state.konditionen_geholt?.konditionen ?? []) as Array<{
          titel: string;
          auszug: string;
        }>;
        const konditionen = konditionsHinweise.length > 0
          ? [texts.conditionsFromKb, ...konditionsHinweise.map((k) => `- [${k.titel}] ${k.auszug}`)]
          : [texts.conditionsFallback];
        const pdf = renderBusinessPdf({
          title: texts.docTitle,
          locale,
          sender: firma,
          recipient: [kunde],
          meta: [[texts.dateLabel, new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB')]],
          body: [texts.salutation, texts.bodyIntro],
          positions: [{ beschreibung: leistung, betragEur }],
          totalLabel: texts.totalLabel,
          closing: [
            ...konditionen,
            texts.lookingForward,
            `${texts.regards}${firma.name ? `\n${firma.name}` : ''}`,
          ],
        });
        const result = await getEmailProvider().send({
          to: email,
          subject: texts.subject(formatEur(betragEur, locale)),
          text: `${entwurf}\n\n${texts.regards}${firma.name ? `\n${firma.name}` : ''}`,
          attachment: { filename: texts.pdfFilename, content: pdf },
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
