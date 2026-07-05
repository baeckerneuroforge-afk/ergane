// Rollenbewusstes Wissens-Retrieval FÜR SKILL-STEPS.
//
// Warum nicht einfach retrieve() aus dem RAG-Layer aufrufen? Die Engine führt
// jeden Step INNERHALB einer withTenant()-Transaktion aus (Step-Effekt +
// skill_step-Zeile + Audit atomar); retrieve() öffnet seine EIGENE
// withTenant()-Transaktion. Verschachtelte Transaktionen blockieren den
// Connection-Pool (mit connection_limit=1 der Test-Suite reproduzierbar:
// "Unable to start a transaction in the given time"). Deshalb läuft hier
// dieselbe Abfrage auf der Step-Transaktion (ctx.tx).
//
// Die WHERE-Klausel ist der 1:1-Spiegel des Disclosure-Filters aus
// src/lib/rag/retrieve.ts — beim Ändern dort HIER mitziehen:
//   - 'open' ist immer sichtbar,
//   - 'restricted'/'confidential' nur mit visibility_grant für die Rolle,
//   - keine/unbekannte Rolle ⇒ nur 'open' (fail-closed).
// Die Rolle ist die des AUSLÖSERS und kommt aus dem Run-Input (die UI-Action
// injiziert sie serverseitig aus der verifizierten Session — nie vom Client).
//
// Ehrlichkeits-Schwelle wie answerQuestion(): nur Treffer mit similarity ≥
// embedder.relevanceThreshold zählen; darunter gilt "kein Wissen".
//
// EMBEDDING außerhalb der Transaktion (Audit-Fix F5): der Embedding-Call ist ein
// Netz-Aufruf (mit Voyage) und darf NICHT die Step-Transaktion offen halten
// (Connection-Pool-Auslastung + 15s-Timeout). Deshalb berechnet der Step-
// prepare()-Hook den Query-Vektor vorab (embedFrage(), Tx-frei) und reicht ihn
// über ctx.prepared in run() → holeWissen(..., { queryVector }). Nur die SQL-
// Abfrage (der eigentliche Tenant-Read) läuft dann in der Transaktion. Wird kein
// Vektor übergeben, embedded holeWissen selbst — Rückwärtskompatibilität für
// jeden anderen Aufrufer, aber die beiden Step-Aufrufer nutzen prepare().
import type { DocumentSource } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getEmbeddingProvider } from '../../ai';
import { assertDimensions, toVectorLiteral } from '../../rag/ingest';
import type { Tx } from '../../tenant';
import type { SkillJson } from '../types';

const KNOWN_ROLES: ReadonlyArray<string> = ['owner', 'admin', 'lead', 'member'];

export interface WissensTreffer {
  titel: string;
  auszug: string;
  aehnlichkeit: number;
}

/** Rolle des Auslösers aus dem Run-Input — fail-closed: fehlt sie oder ist sie
 * unbekannt, wird als "keine Rolle" (nur 'open'-Wissen) weitergegeben. */
export function rolleAusInput(input: SkillJson): string {
  const rolle = typeof input.rolle === 'string' ? input.rolle : '';
  return KNOWN_ROLES.includes(rolle) ? rolle : '';
}

/**
 * Den Query-Vektor für eine Frage berechnen — der Netz-gebundene Teil des
 * Retrievals, herausgelöst aus holeWissen (Audit-Fix F5). Tx-FREI: im
 * prepare()-Hook eines Steps aufrufen, BEVOR die withTenant-Transaktion öffnet,
 * und den Vektor über ctx.prepared in run() → holeWissen(..., { queryVector })
 * reichen. Der Vektor ist als Zahl-Array JSON-serialisierbar (passt in ctx.prepared).
 */
export async function embedFrage(frage: string): Promise<number[]> {
  const f = frage.trim();
  if (!f) throw new Error('embedFrage: frage is required.');
  const embedder = getEmbeddingProvider();
  const [queryVector] = await embedder.embed([f], 'query');
  assertDimensions([queryVector], embedder);
  return queryVector;
}

export async function holeWissen(
  tx: Tx,
  opts: {
    orgId: string;
    frage: string;
    rolle: string;
    k?: number;
    /**
     * OPTIONAL: nur Dokumente dieser Quelle (z. B. 'transcript') als Kontext.
     * Weggelassen ⇒ alle Quellen (bisheriges Verhalten, unverändert). Der Filter
     * ist ADDITIV zum Rollen-Disclosure-Filter — beide müssen gelten.
     */
    source?: DocumentSource;
    /**
     * OPTIONAL: vorab berechneter Query-Vektor (aus embedFrage() im prepare()-
     * Hook). Übergeben ⇒ kein Embedding-Netz-Call in der Transaktion (F5).
     * Weggelassen ⇒ holeWissen embedded selbst (Rückwärtskompatibilität).
     */
    queryVector?: number[];
  },
): Promise<WissensTreffer[]> {
  const frage = opts.frage.trim();
  if (!frage) throw new Error('holeWissen: frage is required.');
  const k = opts.k ?? 5;

  const embedder = getEmbeddingProvider();
  // Vorab-Vektor nutzen wenn vorhanden (F5: kein Netz-Call in der Tx), sonst
  // hier embedden (alter Pfad). In beiden Fällen die Dimension prüfen.
  const queryVector = opts.queryVector ?? (await embedder.embed([frage], 'query'))[0];
  assertDimensions([queryVector], embedder);
  const literal = toVectorLiteral(queryVector);
  const roleText = KNOWN_ROLES.includes(opts.rolle) ? opts.rolle : '';
  // Additiver Quellen-Filter, nur wenn gesetzt. Prisma.empty ⇒ keine
  // zusätzliche Bedingung, also exakt das bisherige Verhalten.
  const sourceFilter = opts.source
    ? Prisma.sql`AND d."source" = ${opts.source}::"document_source"`
    : Prisma.empty;

  const rows = await tx.$queryRaw<
    Array<{ document_title: string; content: string; similarity: number }>
  >`
    SELECT
      d."title"       AS document_title,
      c."content",
      1 - (c."embedding" <=> ${literal}::vector) AS similarity
    FROM "chunks" c
    JOIN "documents" d
      ON d."id" = c."document_id" AND d."org_id" = c."org_id"
    WHERE c."org_id" = ${opts.orgId}::uuid
      ${sourceFilter}
      AND (
        d."visibility" = 'open'
        OR EXISTS (
          SELECT 1 FROM "visibility_grants" g
          WHERE g."org_id" = c."org_id"
            AND g."level" = d."visibility"
            AND g."role"::text = ${roleText}
        )
      )
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${k}
  `;

  return rows
    .filter((r) => r.similarity >= embedder.relevanceThreshold)
    .map((r) => ({ titel: r.document_title, auszug: r.content, aehnlichkeit: r.similarity }));
}
