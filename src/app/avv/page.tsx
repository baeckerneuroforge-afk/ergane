// Auftragsverarbeitungsvertrag (Art. 28 DSGVO) — öffentliche Seite mit dem
// Vertragsgerüst und der verbindlichen Subprozessorenliste. Die markierten
// Platzhalter MÜSSEN vor Abschluss echter AV-Verträge befüllt und der Text
// juristisch geprüft werden.
import type { Metadata } from 'next';
import { LegalPlaceholder as P, PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Auftragsverarbeitungsvertrag — ergane' };

const SUBPROCESSORS: Array<[string, string, string]> = [
  ['Vercel Inc.', 'Hosting & Auslieferung der Anwendung', 'USA (EU-SCCs)'],
  ['Neon Inc.', 'PostgreSQL-Datenbank (Speicherung aller Mandantendaten)', 'EU (Frankfurt)'],
  ['Clerk Inc.', 'Authentifizierung, Nutzer- & Organisationsverwaltung', 'USA (EU-SCCs)'],
  ['Anthropic PBC', 'KI-Verarbeitung (Chat-Antworten, Skills, OCR)', 'USA (EU-SCCs)'],
  ['Voyage AI', 'Text-Embeddings für die semantische Suche', 'USA (EU-SCCs)'],
  ['Resend Inc.', 'Transaktionaler E-Mail-Versand', 'USA (EU-SCCs)'],
];

export default function AvvPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Auftragsverarbeitungsvertrag (AVV)</h1>
        <p className="muted">
          Vertrag über die Verarbeitung personenbezogener Daten im Auftrag gemäß
          Art. 28 DSGVO — zwischen dem Kunden (Verantwortlicher) und{' '}
          <P>Firmenname des Anbieters</P> (Auftragsverarbeiter).
        </p>

        <h2>§ 1 Gegenstand und Dauer</h2>
        <p>
          Der Auftragsverarbeiter betreibt für den Verantwortlichen die SaaS-Plattform
          „ergane“ (Wissensbasis, KI-Chat, Skill-Ausführung mit Freigaben). Die Verarbeitung
          beginnt mit Vertragsschluss und endet mit der Löschung der Organisation.
        </p>

        <h2>§ 2 Art und Zweck der Verarbeitung, Datenarten, Betroffene</h2>
        <ul>
          <li>
            <strong>Zweck:</strong> Bereitstellung der Plattformfunktionen im Auftrag des Kunden.
          </li>
          <li>
            <strong>Datenarten:</strong> Konto- und Rollendaten der Nutzer; vom Kunden
            eingebrachte Dokumente und Chat-Inhalte; Vorgangs- und Audit-Daten.
          </li>
          <li>
            <strong>Betroffene:</strong> Mitarbeitende des Kunden; Personen, deren Daten in den
            eingebrachten Inhalten vorkommen.
          </li>
        </ul>

        <h2>§ 3 Technische und organisatorische Maßnahmen (Art. 32)</h2>
        <ul>
          <li>Mandantentrennung auf Datenbank-Ebene (PostgreSQL Row-Level Security, FORCE).</li>
          <li>Least-Privilege-Datenbankrolle ohne Rechte am Audit-Trail (append-only).</li>
          <li>Transportverschlüsselung (TLS), Verschlüsselung ruhender Daten beim DB-Anbieter.</li>
          <li>Rollenbasierte Zugriffskontrolle, Vier-Augen-Freigaben für handelnde Skills.</li>
          <li>Lückenloser Audit-Trail aller Freigaben, Policy- und Datenänderungen.</li>
        </ul>

        <h2>§ 4 Unterauftragsverhältnisse</h2>
        <p>
          Der Kunde genehmigt die folgenden Subprozessoren. Über Änderungen informiert der
          Auftragsverarbeiter vorab; dem Kunden steht ein Widerspruchsrecht zu.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Subprozessor</th>
              <th>Zweck</th>
              <th>Standort / Garantie</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map(([name, zweck, ort]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{zweck}</td>
                <td>{ort}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>§ 5 Rechte des Verantwortlichen</h2>
        <p>
          Weisungsrecht, Auskunfts- und Kontrollrechte gemäß Art. 28 Abs. 3 DSGVO. Der
          Auftragsverarbeiter unterstützt bei Betroffenenrechten (Export Art. 20, Löschung
          Art. 17 — beides in der Plattform eingebaut) und bei Meldepflichten (Art. 33/34).
        </p>

        <h2>§ 6 Löschung und Rückgabe</h2>
        <p>
          Nach Vertragsende — oder jederzeit auf Weisung — löscht der Auftragsverarbeiter
          sämtliche Daten der Organisation. Die Plattform erzeugt dabei einen Löschnachweis.
          Der vollständige Datenexport steht dem Kunden während der Laufzeit jederzeit als
          Selbstbedienung zur Verfügung.
        </p>

        <h2>§ 7 Schlussbestimmungen</h2>
        <p>
          <P>Haftung, Gerichtsstand, salvatorische Klausel — juristisch ausarbeiten</P>
        </p>

        <p className="muted">
          Stand: <P>Datum</P> · Unterzeichnung: <P>Prozess für die Gegenzeichnung festlegen
          (z. B. PDF-Download mit Signaturfeldern)</P>
        </p>
      </article>
    </PublicShell>
  );
}
