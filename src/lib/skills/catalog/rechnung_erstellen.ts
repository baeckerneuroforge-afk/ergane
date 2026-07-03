// Skill: rechnung_erstellen — Stammdaten prüfen, Rechnung erzeugen und (nach
// Guardrail/Freigabe) "buchen und versenden".
//
// Der zweite GELD-Skill neben beleg_kontieren: handlesMoney:true, dieselbe
// Betrag-Guardrail-Semantik (Summe über 1.000 € ⇒ awaiting_approval, bis ein
// Mensch freigibt), amountOf liefert die Summe für Threshold-Policies.
// Buchung bleibt simuliert (keine Buchhaltungs-Anbindung); der VERSAND geht
// mit input.email wirklich raus (PDF-Anhang, Effekt-Provider — Phase 11),
// sonst simuliert. Beides erst nach Guardrail/Freigabe.
//
// Document language: invoice text, e-mail and PDF follow the ORG locale
// (org_settings.locale, default 'en') — customer-facing output, not the UI.
import { getCompanyProfile } from '../../company';
import { getOrgLocale } from '../../i18n/org';
import { formatEur, getEmailProvider, renderBusinessPdf, type PdfLocale } from '../../effects';
import type { SkillDef, SkillJson } from '../types';
import { emailAusInput } from './angebot_erstellen';

export const RECHNUNG_GUARDRAIL_LIMIT_EUR = 1000;
export const RECHNUNG_GUARDRAIL_REASON =
  'Invoice total over 1,000 EUR — approval required';

interface Position {
  bezeichnung: string;
  betragEur: number;
}

interface RechnungInput {
  kunde: string;
  positionen: Position[];
  summeEur: number;
}

/** Summe des Inputs — Basis für Guardrail und amountOf. Nicht bestimmbar ⇒
 * null (Threshold-Policies und Guardrail behandeln das fail-closed). */
function summeOf(input: SkillJson): number | null {
  if (typeof input.summeEur === 'number' && Number.isFinite(input.summeEur)) {
    return input.summeEur;
  }
  if (Array.isArray(input.positionen)) {
    let summe = 0;
    for (const p of input.positionen) {
      const betrag = (p as Record<string, unknown>)?.betragEur;
      if (typeof betrag !== 'number' || !Number.isFinite(betrag)) return null;
      summe += betrag;
    }
    return input.positionen.length > 0 ? summe : null;
  }
  return null;
}

function parseInput(input: SkillJson): RechnungInput {
  const kunde = typeof input.kunde === 'string' ? input.kunde.trim() : '';
  if (!kunde) throw new Error('rechnung_erstellen: input.kunde is required.');

  if (!Array.isArray(input.positionen) || input.positionen.length === 0) {
    throw new Error('rechnung_erstellen: input.positionen must be a non-empty array.');
  }
  const positionen: Position[] = input.positionen.map((raw, i) => {
    const p = raw as Record<string, unknown>;
    const bezeichnung = typeof p?.bezeichnung === 'string' ? p.bezeichnung.trim() : '';
    const betragEur = typeof p?.betragEur === 'number' ? p.betragEur : NaN;
    if (!bezeichnung) {
      throw new Error(`rechnung_erstellen: positionen[${i}].bezeichnung is required.`);
    }
    if (!Number.isFinite(betragEur) || betragEur <= 0) {
      throw new Error(`rechnung_erstellen: positionen[${i}].betragEur must be a positive number.`);
    }
    return { bezeichnung, betragEur };
  });

  const berechnet = positionen.reduce((s, p) => s + p.betragEur, 0);
  // Explizit mitgegebene Summe muss zu den Positionen passen (fail-closed
  // gegen manipulierte Inputs: nie eine andere Summe buchen als ausgewiesen).
  if (typeof input.summeEur === 'number' && Number.isFinite(input.summeEur)) {
    if (Math.abs(input.summeEur - berechnet) > 0.01) {
      throw new Error(
        `rechnung_erstellen: summeEur (${input.summeEur.toFixed(2)}) does not match ` +
          `the positions total (${berechnet.toFixed(2)}).`,
      );
    }
  }
  return { kunde, positionen, summeEur: berechnet };
}

/** Customer-facing wording per document language (org locale). */
const TEXTS: Record<PdfLocale, {
  docTitle: string;
  invoiceText: (kunde: string, count: number, total: string) => string;
  dateLabel: string;
  salutation: string;
  bodyIntro: string;
  totalLabel: string;
  payToFooterAccount: string;
  payWithReference: string;
  regards: string;
  subject: (amount: string) => string;
  pdfFilename: string;
}> = {
  en: {
    docTitle: 'Invoice',
    invoiceText: (kunde, count, total) =>
      `Invoice to ${kunde} — ${count} line item(s), total ${total} EUR`,
    dateLabel: 'Date',
    salutation: 'Dear Sir or Madam,',
    bodyIntro: 'we hereby invoice you for the following services:',
    totalLabel: 'Total',
    payToFooterAccount: 'Please transfer the total amount to the account stated in the footer.',
    payWithReference: 'Please transfer the total amount quoting the invoice details.',
    regards: 'Kind regards',
    subject: (amount) => `Your invoice for ${amount}`,
    pdfFilename: 'invoice.pdf',
  },
  de: {
    docTitle: 'Rechnung',
    invoiceText: (kunde, count, total) =>
      `Rechnung an ${kunde} — ${count} Position(en), gesamt ${total} EUR`,
    dateLabel: 'Datum',
    salutation: 'Sehr geehrte Damen und Herren,',
    bodyIntro: 'wir erlauben uns, Ihnen die folgenden Leistungen in Rechnung zu stellen:',
    totalLabel: 'Gesamtsumme',
    payToFooterAccount: 'Bitte überweisen Sie den Gesamtbetrag auf das in der Fußzeile genannte Konto.',
    payWithReference: 'Bitte überweisen Sie den Gesamtbetrag unter Angabe der Rechnungsdaten.',
    regards: 'Mit freundlichen Grüßen',
    subject: (amount) => `Ihre Rechnung über ${amount}`,
    pdfFilename: 'rechnung.pdf',
  },
};

export const rechnungErstellen: SkillDef = {
  key: 'rechnung_erstellen',
  title: 'Create and post an invoice',
  handlesMoney: true,
  guardrail: (input) => {
    const summe = summeOf(input);
    // Fail-closed: nicht bestimmbare Summe verhält sich wie "über der Schwelle".
    if (summe === null || summe > RECHNUNG_GUARDRAIL_LIMIT_EUR) {
      return { triggered: true, reason: RECHNUNG_GUARDRAIL_REASON };
    }
    return { triggered: false };
  },
  amountOf: summeOf,
  steps: [
    {
      // liest nur: Input-/Stammdaten-Validierung (fail ⇒ Run wird 'failed',
      // bevor irgendein handelnder Schritt erreichbar ist).
      name: 'stammdaten_geprueft',
      run: async ({ input }) => {
        const { kunde, positionen, summeEur } = parseInput(input);
        return { kunde, positionsAnzahl: positionen.length, summeEur, geprueft: true };
      },
    },
    {
      // liest nur: Rechnung als Dokumentstruktur erzeugen (deterministisch).
      name: 'rechnung_erzeugt',
      run: async ({ orgId, tx, input }) => {
        const { kunde, positionen, summeEur } = parseInput(input);
        const locale = await getOrgLocale(tx, orgId);
        return {
          empfaenger: kunde,
          positionen: positionen.map((p, i) => ({
            pos: i + 1,
            bezeichnung: p.bezeichnung,
            betragEur: p.betragEur,
          })),
          summeEur,
          rechnungstext: TEXTS[locale].invoiceText(kunde, positionen.length, summeEur.toFixed(2)),
        };
      },
    },
    {
      // Der HANDELNDE Schritt: simulierte Buchung + Versand — gated durch die
      // Betrag-Guardrail (Summe > 1.000 € ⇒ erst nach menschlicher Freigabe).
      name: 'gebucht_versendet',
      acts: true,
      run: async ({ orgId, tx, input, state }) => {
        const { kunde, positionen, summeEur } = parseInput(input);
        const email = emailAusInput(input);
        if (!email) {
          return {
            gebucht: true,
            versendetAn: kunde,
            summeEur,
            simuliert: true, // keine Empfänger-Adresse ⇒ kein echter Versand
          };
        }

        // Firmendaten aus den Einstellungen → Briefkopf/Fußzeile (USt-IdNr.,
        // Bankverbindung). Leeres Profil ⇒ neutrales PDF. Sprache = Org-Locale.
        const locale = await getOrgLocale(tx, orgId);
        const texts = TEXTS[locale];
        const firma = await getCompanyProfile(tx, orgId);
        const rechnungstext = typeof state.rechnung_erzeugt?.rechnungstext === 'string'
          ? state.rechnung_erzeugt.rechnungstext
          : texts.invoiceText(kunde, positionen.length, summeEur.toFixed(2));
        const pdf = renderBusinessPdf({
          title: texts.docTitle,
          locale,
          sender: firma,
          recipient: [kunde],
          meta: [[texts.dateLabel, new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB')]],
          body: [texts.salutation, texts.bodyIntro],
          positions: positionen.map((p) => ({ beschreibung: p.bezeichnung, betragEur: p.betragEur })),
          totalLabel: texts.totalLabel,
          closing: [
            firma.bank ? texts.payToFooterAccount : texts.payWithReference,
            `${texts.regards}${firma.name ? `\n${firma.name}` : ''}`,
          ],
        });
        const zeilen = [
          rechnungstext,
          '',
          ...positionen.map((p, i) => `${i + 1}. ${p.bezeichnung} — ${formatEur(p.betragEur, locale)}`),
          '',
          `${texts.totalLabel}: ${formatEur(summeEur, locale)}`,
        ];
        const result = await getEmailProvider().send({
          to: email,
          subject: texts.subject(formatEur(summeEur, locale)),
          text: `${zeilen.join('\n')}\n\n${texts.regards}${firma.name ? `\n${firma.name}` : ''}`,
          attachment: { filename: texts.pdfFilename, content: pdf },
        });
        return {
          gebucht: true, // Buchung weiterhin simuliert (keine Buchhaltungs-Anbindung)
          versendetAn: kunde,
          empfaengerEmail: email,
          summeEur,
          simuliert: false,
          emailId: result.id,
          emailProvider: result.provider,
          pdfBytes: pdf.length,
        };
      },
    },
  ],
};
