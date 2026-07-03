// Imprint (§ 5 TMG / § 18 MStV) — English version of /impressum. The marked
// placeholders MUST be filled with the company details before real customer
// operation. The German version (/impressum) remains the authoritative one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPlaceholder as P, PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Imprint — ergane' };

export default function ImprintPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Imprint</h1>
        <p className="muted">
          English convenience translation — the German <Link href="/impressum">Impressum</Link>{' '}
          is the authoritative version.
        </p>

        <h2>Information according to § 5 TMG</h2>
        <p>
          <P>Company name and legal form</P>
          <br />
          <P>Street and number</P>
          <br />
          <P>Postal code and city</P>
        </p>

        <h2>Represented by</h2>
        <p>
          <P>Managing director / owner</P>
        </p>

        <h2>Contact</h2>
        <p>
          E-mail: <P>contact@…</P>
          <br />
          Phone: <P>+49 …</P>
        </p>

        <h2>Commercial register</h2>
        <p>
          <P>Register court and commercial register number — or note "not registered"</P>
        </p>

        <h2>VAT ID</h2>
        <p>
          VAT identification number according to § 27a UStG: <P>DE…</P>
        </p>

        <h2>Responsible for the content according to § 18 (2) MStV</h2>
        <p>
          <P>Name and address of the responsible person</P>
        </p>
      </article>
    </PublicShell>
  );
}
