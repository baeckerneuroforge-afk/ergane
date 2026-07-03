// Öffentliche Startseite. '/' ist eine Middleware-Ausnahme: Besucher sehen
// die Landing-Page, eingeloggte Nutzer werden direkt ins Dashboard geleitet
// (dort greift der volle Tenant-Guard unverändert).
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PublicShell } from './public-shell';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'Mandantentrennung per Datenbank',
    text: 'Tenant-Isolation erzwingt PostgreSQL Row-Level Security mit FORCE — nicht App-Code-Disziplin. Ein vergessenes WHERE kann strukturell keine fremden Daten leaken.',
  },
  {
    title: 'Wissensbasis mit belegten Antworten',
    text: 'PDF, DOCX, Markdown und Text (inkl. OCR für Scans) werden semantisch durchsuchbar. Der Chat antwortet mit Quellenangabe — oder sagt ehrlich, dass er es nicht weiß.',
  },
  {
    title: 'Skills mit menschlicher Freigabe',
    text: 'Angebote, Rechnungen, Kontierung: Alles, was Geld bewegt oder das Haus verlässt, pausiert für eine menschliche Freigabe — nicht abschaltbar, lückenlos auditiert.',
  },
  {
    title: 'DSGVO eingebaut, nicht angeflanscht',
    text: 'Datenexport (Art. 20), Löschkonzept mit Nachweis, Pseudonymisierung im Audit-Trail, automatische Aufbewahrungsfristen. EU-Datenbankstandort.',
  },
];

export default async function Home() {
  const { userId, orgId } = await auth();
  if (userId) redirect(orgId ? '/dashboard' : '/select-org');

  return (
    <PublicShell>
      <section className="public-hero">
        <h1>Die DSGVO-native KI-Plattform für den Mittelstand</h1>
        <p>
          ergane beantwortet Fragen aus Ihrem Firmenwissen mit Quellenangabe und erledigt
          Aufgaben mit eingebauter menschlicher Freigabe — mandantengetrennt auf
          Datenbank-Ebene, jede Handlung im Audit-Trail.
        </p>
        <div className="public-hero-actions">
          <Link href="/sign-up" className="btn btn--primary">
            Kostenlos starten
          </Link>
          <Link href="/sign-in" className="btn">
            Anmelden
          </Link>
        </div>
      </section>

      <section className="public-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h2>{f.title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {f.text}
            </p>
          </div>
        ))}
      </section>
    </PublicShell>
  );
}
