// Tages-Nutzungslimits pro Tenant — Kostenschutz für die bezahlten Effekte
// (LLM-/Embedding-Aufrufe, Versand), NICHT Governance.
//
// Bewusst einfach gehalten:
//   - Kein neuer Zustand: gezählt werden die Zeilen, die die Aktionen ohnehin
//     schreiben (chat_messages des Nutzers, documents, skill_runs) — im
//     withTenant-Tx des Aufrufers, also RLS-scoped und nicht manipulierbar.
//   - Plattform-Defaults, per Env übersteuerbar (LIMIT_* = Anzahl pro Tag;
//     Wert <= 0 schaltet das jeweilige Limit ab). KEINE Tenant-Einstellung:
//     ein Tenant soll sein eigenes Kostenlimit nicht anheben können.
//   - Weiches Limit: parallele Requests können es um wenige Einheiten
//     überschreiten — als Kostenschutz völlig ausreichend, dafür ohne
//     Lock-/Countertabelle.
//   - Fehlermeldungen deutsch (sie erreichen den Nutzer direkt).
import type { Tx } from './tenant';

export type LimitKind = 'chat' | 'ingest' | 'run';

const DEFAULTS: Record<LimitKind, number> = {
  chat: 200, // Fragen pro Tag und Tenant
  ingest: 100, // neue Dokumente/Uploads pro Tag und Tenant
  run: 200, // Skill-Läufe pro Tag und Tenant
};

const ENV_KEYS: Record<LimitKind, string> = {
  chat: 'LIMIT_CHAT_PER_DAY',
  ingest: 'LIMIT_INGEST_PER_DAY',
  run: 'LIMIT_RUNS_PER_DAY',
};

const MESSAGES: Record<LimitKind, (limit: number) => string> = {
  chat: (l) =>
    `Tageslimit erreicht: ${l} Chat-Anfragen pro Tag. Bitte morgen erneut versuchen oder den Support kontaktieren.`,
  ingest: (l) =>
    `Tageslimit erreicht: ${l} neue Dokumente pro Tag. Bitte morgen erneut versuchen oder den Support kontaktieren.`,
  run: (l) =>
    `Tageslimit erreicht: ${l} Skill-Läufe pro Tag. Bitte morgen erneut versuchen oder den Support kontaktieren.`,
};

/** Wirksames Limit: Env-Override oder Default; <= 0 ⇒ unbegrenzt (null). */
export function effectiveLimit(kind: LimitKind): number | null {
  const raw = process.env[ENV_KEYS[kind]];
  const value = raw === undefined || raw.trim() === '' ? DEFAULTS[kind] : Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Heutige Nutzung im Tx des AUFRUFERS zählen (RLS-scoped). */
async function usedToday(tx: Tx, kind: LimitKind): Promise<number> {
  const since = startOfToday();
  switch (kind) {
    case 'chat':
      // Nur Nutzerfragen zählen (Antworten des Assistenten sind Folgekosten
      // derselben Frage).
      return tx.chatMessage.count({ where: { role: 'user', createdAt: { gte: since } } });
    case 'ingest':
      return tx.document.count({ where: { createdAt: { gte: since } } });
    case 'run':
      return tx.skillRun.count({ where: { createdAt: { gte: since } } });
  }
}

/**
 * Fail-closed-Gate vor der teuren Aktion: wirft mit deutscher Meldung, wenn
 * das Tageslimit erreicht ist. Im withTenant-Tx des Aufrufers verwenden.
 */
export async function assertWithinDailyLimit(tx: Tx, kind: LimitKind): Promise<void> {
  const limit = effectiveLimit(kind);
  if (limit === null) return;
  const used = await usedToday(tx, kind);
  if (used >= limit) {
    throw new Error(MESSAGES[kind](limit));
  }
}
