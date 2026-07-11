// Data Processing Agreement (Art. 28 GDPR) — English version of /avv with the
// contract skeleton and the binding subprocessor list. The marked placeholders
// MUST be filled and the text legally reviewed before concluding real DPAs.
// The German version (/avv) is the authoritative one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '../public-shell';

export const metadata: Metadata = { title: 'Data Processing Agreement — helix.ai' };

const SUBPROCESSORS: Array<[string, string, string]> = [
  ['Vercel Inc.', 'Hosting & delivery of the application', 'USA (EU SCCs)'],
  ['Neon Inc.', 'PostgreSQL database (storage of all tenant data)', 'EU (Frankfurt)'],
  ['Clerk Inc.', 'Authentication, user & organization management', 'USA (EU SCCs)'],
  ['Anthropic PBC', 'AI processing (chat answers, skills, OCR)', 'USA (EU SCCs)'],
  ['Voyage AI', 'Text embeddings for semantic search', 'USA (EU SCCs)'],
  ['Resend Inc.', 'Transactional e-mail delivery', 'USA (EU SCCs)'],
];

export default function DpaPage() {
  return (
    <PublicShell>
      <article className="legal">
        <h1>Data Processing Agreement (DPA)</h1>
        <p className="muted">
          Agreement on the processing of personal data on behalf of the controller according
          to Art. 28 GDPR — between the customer (controller) and the pilot-stage operator
          (Hephaistos Systems / helix.ai, processor). Full legal entity details will be
          completed before general availability. English convenience translation — the German{' '}
          <Link href="/avv">AV-Vertrag</Link> is the authoritative version.
        </p>

        <h2>§ 1 Subject matter and duration</h2>
        <p>
          The processor operates the SaaS platform "helix.ai" (knowledge base, AI chat, skill
          execution with approvals) for the controller. Processing starts with the conclusion
          of the contract and ends with the deletion of the organization.
        </p>

        <h2>§ 2 Nature and purpose of processing, data categories, data subjects</h2>
        <ul>
          <li>
            <strong>Purpose:</strong> providing the platform functions on behalf of the customer.
          </li>
          <li>
            <strong>Data categories:</strong> account and role data of the users; documents and
            chat content contributed by the customer; process and audit data.
          </li>
          <li>
            <strong>Data subjects:</strong> the customer's employees; persons whose data appears
            in the contributed content.
          </li>
        </ul>

        <h2>§ 3 Technical and organizational measures (Art. 32)</h2>
        <ul>
          <li>Tenant isolation at the database level (PostgreSQL row-level security, FORCE).</li>
          <li>Least-privilege database role without rights on the audit trail (append-only).</li>
          <li>Transport encryption (TLS), encryption at rest at the database provider.</li>
          <li>Role-based access control, four-eyes approvals for acting skills.</li>
          <li>Complete audit trail of all approvals, policy and data changes.</li>
        </ul>

        <h2>§ 4 Subprocessors</h2>
        <p>
          The customer approves the following subprocessors. The processor informs about
          changes in advance; the customer has a right to object.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Subprocessor</th>
              <th>Purpose</th>
              <th>Location / safeguard</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map(([name, purpose, location]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{purpose}</td>
                <td>{location}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>§ 5 Rights of the controller</h2>
        <p>
          Right to issue instructions, information and inspection rights according to
          Art. 28 (3) GDPR. The processor supports data subject rights (export Art. 20,
          deletion Art. 17 — both built into the platform) and notification duties
          (Art. 33/34).
        </p>

        <h2>§ 6 Deletion and return</h2>
        <p>
          After the end of the contract — or at any time on instruction — the processor
          deletes all data of the organization. The platform generates a deletion proof.
          The complete data export is available to the customer as self-service at any time
          during the term.
        </p>

        <h2>§ 7 Final provisions</h2>
        <p>
          Liability, place of jurisdiction, and severability will be finalized in the
          countersigned pilot DPA package. Until then this page is informational for
          pilot discussions only — contact{' '}
          <a href="mailto:pilot@helix.ai">pilot@helix.ai</a>.
        </p>

        <p className="muted">Version: pilot stage · not a countersigned contract by itself.</p>
      </article>
    </PublicShell>
  );
}
