// Money display — the ONE place that knows the feature currency.
//
// Project-wide convention: every monetary figure of the value dashboard is
// computed and displayed in US dollars. Nothing outside this file hardcodes a
// "$" or a currency code; to change the currency (or make it switchable per
// org later) this constant — and only this constant — moves.
//
// Note: formatEuro (src/lib/i18n) intentionally stays separate — it formats
// EUR amounts of the skill inputs/guardrails, a different domain.

/** ISO 4217 code of the value-dashboard currency. */
export const CURRENCY = 'USD';

const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
});

/** Formats an amount in the feature currency, e.g. 1234.5 → "$1,234.50". */
export function formatMoney(amount: number): string {
  return fmt.format(amount);
}
