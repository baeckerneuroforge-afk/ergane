// Skill: beleg_kontieren — einen Beleg lesen, Konto vorschlagen, Buchung
// vorbereiten und (nach Guardrail/Freigabe) verbuchen.
//
// handlesMoney: true → der letzte, HANDELNDE Schritt ("verbucht") ist durch die
// Guardrail gated: Beträge über 1.000 € pausieren den Run in awaiting_approval,
// bis ein Mensch freigibt. Es gibt bewusst KEINE echte DATEV-Anbindung — der
// Verbuchen-Schritt ist ein simulierter Effekt (Detail + Audit), was für den
// End-to-End-Beweis der Engine reicht.
import type { SkillDef, SkillJson } from '../types';

export const GUARDRAIL_LIMIT_EUR = 1000;
export const GUARDRAIL_REASON = 'Amount over 1,000 EUR — approval required';

interface BelegInput {
  beschreibung: string;
  betragEur: number;
  belegNummer?: string;
}

function parseInput(input: SkillJson): BelegInput {
  const beschreibung = typeof input.beschreibung === 'string' ? input.beschreibung.trim() : '';
  const betragEur = typeof input.betragEur === 'number' ? input.betragEur : NaN;
  if (!beschreibung) throw new Error('beleg_kontieren: input.beschreibung is required.');
  if (!Number.isFinite(betragEur) || betragEur <= 0) {
    throw new Error('beleg_kontieren: input.betragEur must be a positive number.');
  }
  return {
    beschreibung,
    betragEur,
    belegNummer: typeof input.belegNummer === 'string' ? input.belegNummer : undefined,
  };
}

// Deterministic account suggestion (SKR03-style). Deliberately a rule table —
// no LLM call, so tests/demo run offline; a RAG-backed suggestion (retrieve()
// over the tenant knowledge base) can replace this later without touching the
// engine, because a step is just a function of its context.
const ACCOUNT_RULES: Array<{ pattern: RegExp; konto: string; kontoName: string }> = [
  { pattern: /bahn|taxi|flug|hotel|reise/i, konto: '4670', kontoName: 'Reisekosten Arbeitnehmer' },
  { pattern: /büro|papier|stift|toner/i, konto: '4930', kontoName: 'Bürobedarf' },
  { pattern: /software|lizenz|saas|cloud/i, konto: '4806', kontoName: 'Wartungskosten Soft-/Hardware' },
  { pattern: /bewirtung|restaurant|essen/i, konto: '4650', kontoName: 'Bewirtungskosten' },
];
const FALLBACK_ACCOUNT = { konto: '4900', kontoName: 'Sonstige betriebliche Aufwendungen' };

export const belegKontieren: SkillDef = {
  key: 'beleg_kontieren',
  title: 'Code and post a receipt',
  handlesMoney: true,
  guardrail: (input) => {
    const { betragEur } = parseInput(input);
    return betragEur > GUARDRAIL_LIMIT_EUR
      ? { triggered: true, reason: GUARDRAIL_REASON }
      : { triggered: false };
  },
  amountOf: (input) =>
    typeof input.betragEur === 'number' && Number.isFinite(input.betragEur)
      ? input.betragEur
      : null,
  steps: [
    {
      name: 'beleg_gelesen',
      run: async ({ input }) => {
        const beleg = parseInput(input);
        return { ...beleg };
      },
    },
    {
      name: 'konto_vorgeschlagen',
      run: async ({ input }) => {
        const { beschreibung } = parseInput(input);
        const rule = ACCOUNT_RULES.find((r) => r.pattern.test(beschreibung)) ?? FALLBACK_ACCOUNT;
        return {
          konto: rule.konto,
          kontoName: rule.kontoName,
          begruendung: `Suggestion based on the receipt description "${beschreibung}"`,
        };
      },
    },
    {
      name: 'buchung_vorbereitet',
      run: async ({ input, state }) => {
        const { betragEur, belegNummer } = parseInput(input);
        const konto = String(state.konto_vorgeschlagen?.konto ?? FALLBACK_ACCOUNT.konto);
        return {
          buchungssatz: `${konto} an 1200`,
          betragEur,
          belegNummer: belegNummer ?? null,
          buchungstext: `Receipt ${belegNummer ?? '(no number)'} — ${betragEur.toFixed(2)} EUR`,
        };
      },
    },
    {
      // Der HANDELNDE Schritt: simulierter Buchungs-Effekt, gated durch die
      // Guardrail (Betrag > 1.000 € ⇒ erst nach menschlicher Freigabe).
      name: 'verbucht',
      acts: true,
      // Probelauf-Vorschau (read-only): WAS gebucht würde, ohne es zu tun.
      describeEffect: ({ input, state }) => ({
        wirkung: 'Would post the receipt (simulated DATEV booking)',
        konto: state.konto_vorgeschlagen?.konto ?? null,
        buchungssatz: state.buchung_vorbereitet?.buchungssatz ?? null,
        betragEur: typeof input.betragEur === 'number' ? input.betragEur : null,
      }),
      run: async ({ input, state }) => {
        const { betragEur } = parseInput(input);
        return {
          verbucht: true,
          konto: state.konto_vorgeschlagen?.konto ?? null,
          betragEur,
          simuliert: true, // keine echte DATEV-Anbindung in dieser Phase
        };
      },
    },
  ],
};
