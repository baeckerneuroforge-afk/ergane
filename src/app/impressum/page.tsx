// Impressum (§ 5 TMG / § 18 MStV) — öffentliche Seite. Die markierten
// Platzhalter MÜSSEN vor echtem Kundenbetrieb mit den Unternehmensdaten
// befüllt werden.
import type { Metadata } from 'next';
import { LegalPlaceholder as P, PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Impressum — ergane' };

export default function ImpressumPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Impressum</h1>

        <h2>Angaben gemäß § 5 TMG</h2>
        <p>
          <P>Firmenname und Rechtsform</P>
          <br />
          <P>Straße und Hausnummer</P>
          <br />
          <P>PLZ und Ort</P>
        </p>

        <h2>Vertreten durch</h2>
        <p>
          <P>Geschäftsführung / Inhaber</P>
        </p>

        <h2>Kontakt</h2>
        <p>
          E-Mail: <P>kontakt@…</P>
          <br />
          Telefon: <P>+49 …</P>
        </p>

        <h2>Registereintrag</h2>
        <p>
          <P>Registergericht und Handelsregisternummer — oder Hinweis „nicht eingetragen“</P>
        </p>

        <h2>Umsatzsteuer-ID</h2>
        <p>
          Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: <P>DE…</P>
        </p>

        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>
          <P>Name und Anschrift der verantwortlichen Person</P>
        </p>
      </article>
    </PublicShell>
  );
}
