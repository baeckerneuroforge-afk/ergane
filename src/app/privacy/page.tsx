// Privacy policy (Art. 13/14 GDPR) — English version of /datenschutz. The
// structure is complete; the marked placeholders (controller, DPO if any)
// MUST be filled and the text legally reviewed before real customer
// operation. The German version (/datenschutz) is the authoritative one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPlaceholder as P, PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Privacy Policy — ergane' };

const PROCESSORS: Array<[string, string, string]> = [
  ['Vercel Inc.', 'Hosting & delivery of the application', 'USA (EU SCCs)'],
  ['Neon Inc.', 'PostgreSQL database', 'EU (Frankfurt, eu-central-1)'],
  ['Clerk Inc.', 'Authentication & organization management', 'USA (EU SCCs)'],
  ['Anthropic PBC', 'AI answers (chat, skills, OCR)', 'USA (EU SCCs)'],
  ['Voyage AI', 'Semantic text embeddings', 'USA (EU SCCs)'],
  ['Resend Inc.', 'Transactional e-mail delivery', 'USA (EU SCCs)'],
];

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="muted">
          English convenience translation — the German{' '}
          <Link href="/datenschutz">Datenschutzerklärung</Link> is the authoritative version.
        </p>

        <h2>1. Controller</h2>
        <p>
          <P>Company name, address, e-mail of the controller</P>
          <br />
          Data protection officer (if appointed): <P>name and contact — otherwise remove this section</P>
        </p>

        <h2>2. What data we process</h2>
        <ul>
          <li>
            <strong>Account and organization data</strong> (name, e-mail, role, organization) —
            to provide tenant-isolated access (Art. 6 (1) (b) GDPR).
          </li>
          <li>
            <strong>Content data</strong> (uploaded documents, chat questions and answers,
            skill inputs) — to provide the commissioned functions (Art. 6 (1) (b)).
            Content stays within your own tenant; isolation is enforced by the
            database (row-level security).
          </li>
          <li>
            <strong>Audit data</strong> (who approved/changed what and when) — legitimate
            interest in traceability and security (Art. 6 (1) (f)).
          </li>
        </ul>

        <h2>3. Processors</h2>
        <p>We use the following service providers as processors:</p>
        <table className="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
              <th>Location / safeguard</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map(([name, purpose, location]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{purpose}</td>
                <td>{location}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          EU standard contractual clauses (SCCs) are in place for third-country transfers.
        </p>

        <h2>4. Retention</h2>
        <p>
          Content data is stored for as long as the organization uses the account.
          Organizations can configure retention periods for chat histories (automatic
          deletion) and can trigger a complete export or the deletion of all data at any
          time. When an organization is deleted, all data including the audit trail is
          removed; a deletion proof is generated.
        </p>

        <h2>5. Your rights</h2>
        <p>
          You have the rights to access (Art. 15), rectification (Art. 16), erasure
          (Art. 17), restriction (Art. 18), data portability (Art. 20) and objection
          (Art. 21), as well as the right to lodge a complaint with a supervisory
          authority (Art. 77). Contact <P>privacy@…</P> for any of these.
        </p>

        <h2>6. Cookies & tracking</h2>
        <p>
          ergane uses only technically necessary cookies (session/sign-in via Clerk and the
          language preference). There is no ad tracking and there are no analytics cookies.
        </p>
      </article>
    </PublicShell>
  );
}
