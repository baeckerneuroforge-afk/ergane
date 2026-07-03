// Datenschutzerklärung (Art. 13/14 DSGVO) — öffentliche Seite. Struktur ist
// vollständig; die markierten Platzhalter (Verantwortlicher, ggf. DSB) MÜSSEN
// vor echtem Kundenbetrieb befüllt und der Text juristisch geprüft werden.
import type { Metadata } from 'next';
import { LegalPlaceholder as P, PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Datenschutzerklärung — ergane' };

const PROCESSORS: Array<[string, string, string]> = [
  ['Vercel Inc.', 'Hosting & Auslieferung der Anwendung', 'USA (EU-SCCs)'],
  ['Neon Inc.', 'PostgreSQL-Datenbank', 'EU (Frankfurt, eu-central-1)'],
  ['Clerk Inc.', 'Authentifizierung & Organisationsverwaltung', 'USA (EU-SCCs)'],
  ['Anthropic PBC', 'KI-Antworten (Chat, Skills, OCR)', 'USA (EU-SCCs)'],
  ['Voyage AI', 'Semantische Text-Embeddings', 'USA (EU-SCCs)'],
  ['Resend Inc.', 'Transaktionaler E-Mail-Versand', 'USA (EU-SCCs)'],
];

export default function DatenschutzPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Datenschutzerklärung</h1>

        <h2>1. Verantwortlicher</h2>
        <p>
          <P>Firmenname, Anschrift, E-Mail des Verantwortlichen</P>
          <br />
          Datenschutzbeauftragter (falls benannt): <P>Name und Kontakt — sonst Abschnitt entfernen</P>
        </p>

        <h2>2. Welche Daten wir verarbeiten</h2>
        <ul>
          <li>
            <strong>Konto- und Organisationsdaten</strong> (Name, E-Mail, Rolle, Organisation) —
            zur Bereitstellung des mandantengetrennten Zugangs (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Inhaltsdaten</strong> (hochgeladene Dokumente, Chat-Fragen und -Antworten,
            Skill-Eingaben) — zur Erbringung der beauftragten Funktionen (Art. 6 Abs. 1 lit. b).
            Inhalte bleiben dem eigenen Mandanten vorbehalten; die Trennung erzwingt die
            Datenbank (Row-Level Security).
          </li>
          <li>
            <strong>Audit-Daten</strong> (wer hat wann was freigegeben/geändert) — berechtigtes
            Interesse an Nachvollziehbarkeit und Sicherheit (Art. 6 Abs. 1 lit. f).
          </li>
        </ul>

        <h2>3. Auftragsverarbeiter</h2>
        <p>Wir setzen folgende Dienstleister als Auftragsverarbeiter ein:</p>
        <table className="table">
          <thead>
            <tr>
              <th>Dienstleister</th>
              <th>Zweck</th>
              <th>Standort / Garantie</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map(([name, zweck, ort]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{zweck}</td>
                <td>{ort}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Für Übermittlungen in Drittländer bestehen EU-Standardvertragsklauseln (SCCs).
        </p>

        <h2>4. Speicherdauer</h2>
        <p>
          Inhaltsdaten werden gespeichert, solange die Organisation das Konto nutzt.
          Organisationen können Aufbewahrungsfristen für Chat-Verläufe konfigurieren
          (automatische Löschung) und jederzeit den vollständigen Export oder die Löschung
          aller Daten anstoßen. Bei Löschung der Organisation werden sämtliche Daten
          einschließlich des Audit-Trails entfernt; ein Löschnachweis wird erzeugt.
        </p>

        <h2>5. Ihre Rechte</h2>
        <p>
          Sie haben die Rechte auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung
          (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch
          (Art. 21) sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde (Art. 77).
          Wenden Sie sich dazu an <P>datenschutz@…</P>.
        </p>

        <h2>6. Cookies & Tracking</h2>
        <p>
          ergane setzt ausschließlich technisch notwendige Cookies (Sitzung/Anmeldung über
          Clerk). Es gibt kein Werbe-Tracking und keine Analyse-Cookies.
        </p>
      </article>
    </PublicShell>
  );
}
