// The correction proposal attached to a flag when autonomy is 'suggest' or
// 'autonomous' — plan §4. Under 'suggest' a human triggers it; under 'autonomous'
// the loop auto-starts it (Schritt E). The proposal itself is identical.
//
// SCOPE, deliberately narrow (plan §11, risk D): a proposal is ONLY ever a
// re-run of the SAME skill with the SAME inputs. No new logic, no cleverness —
// just "do it again". That keeps the feature honest and un-scopeable-creepable:
// the correction the human triggers is byte-for-byte the run they already saw,
// re-executed, and it goes through the normal approval gate like any other run.
//
// Two parts live together here so the flag paths (evaluate.ts, tick.ts) and the
// projection (flags-view.ts) agree on one shape:
//   - suggestedAction: a human-readable one-liner shown in the UI / Slack.
//   - correction: the MACHINE reference /api/loop/correct needs to re-run. It
//     is a re-run pointer (sourceRunId → its stored input), never free-form.
// A flag only gets BOTH when there is a concrete run to re-run. A metric flag
// with no single originating run gets a suggestedAction but NO correction (and
// therefore no "start correction" button) — offering a blind re-run there would
// be dishonest.

import type { Locale } from '../i18n';

/** The re-run reference carried in a flag's detail (JSON-serialisable). */
export interface CorrectionRef {
  /** The skill to re-run — must be a live, known skill key. */
  skillKey: string;
  /** The original run whose stored input is replayed verbatim. */
  sourceRunId: string;
  /** The client the original run was for, if any (carried through to the re-run). */
  clientId: string | null;
}

const SUGGEST_TEXT: Record<Locale, (skillTitle: string, client: string | null) => string> = {
  en: (skillTitle, client) =>
    client
      ? `Re-run “${skillTitle}” for ${client} with the same inputs (goes through the normal approval gate).`
      : `Re-run “${skillTitle}” with the same inputs (goes through the normal approval gate).`,
  de: (skillTitle, client) =>
    client
      ? `„${skillTitle}“ für ${client} mit denselben Eingaben erneut ausführen (durchläuft das normale Approval-Gate).`
      : `„${skillTitle}“ mit denselben Eingaben erneut ausführen (durchläuft das normale Approval-Gate).`,
};

/**
 * Build the human-readable suggestion line for a CRITERIA flag. `skillTitle` is
 * the localized skill title (fall back to the key); `clientName` is null when
 * the run is not tied to a client. Pure — no data access.
 */
export function buildSuggestedActionText(
  locale: Locale,
  skillTitle: string,
  clientName: string | null,
): string {
  return SUGGEST_TEXT[locale](skillTitle, clientName);
}

// A metric drift has no single run to replay, so its suggestion is a REVIEW
// pointer, not a re-run: "look at what caused this". Honest and button-less.
const METRIC_SUGGEST_TEXT: Record<Locale, string> = {
  en: 'Review the runs in this window and adjust — no automatic correction (a metric trend has no single run to re-run).',
  de: 'Die Läufe in diesem Zeitraum prüfen und nachsteuern — keine automatische Korrektur (ein Metrik-Trend hat keinen einzelnen Lauf zum erneut Ausführen).',
};

/** The review-oriented suggestion line for a METRIC flag. Pure. */
export function buildMetricSuggestedActionText(locale: Locale): string {
  return METRIC_SUGGEST_TEXT[locale];
}

// Tool/ticket flags also have no helix skill to re-run — review-only suggestion.
const TOOL_SUGGEST_TEXT: Record<Locale, (ref: string) => string> = {
  en: (ref) =>
    `Review ${ref} in the source tool (board/tracker) — no automatic correction (tool work is not a helix re-run).`,
  de: (ref) =>
    `${ref} im Quell-Tool (Board) prüfen — keine automatische Korrektur (Tool-Arbeit ist kein helix-Re-Run).`,
};

/** Review-oriented suggestion for a tool-criteria flag (no correction pointer). */
export function buildToolSuggestedActionText(locale: Locale, externalRef: string): string {
  return TOOL_SUGGEST_TEXT[locale](externalRef);
}
