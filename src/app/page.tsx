// Öffentliche Startseite. '/' ist eine Middleware-Ausnahme: Besucher sehen
// die Landing-Page, eingeloggte Nutzer werden direkt ins Dashboard geleitet
// (dort greift der volle Tenant-Guard unverändert). Sprache: UI-Cookie,
// Default Englisch — der Umschalter sitzt im PublicShell-Header.
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n/server';
import { PublicShell } from './public-shell';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId, orgId } = await auth();
  if (userId) redirect(orgId ? '/dashboard' : '/select-org');

  const { t } = await getI18n();

  return (
    <PublicShell>
      <section className="public-hero">
        <h1>{t.landing.heroTitle}</h1>
        <p>{t.landing.heroText}</p>
        <div className="public-hero-actions">
          <Link href="/sign-up" className="btn btn--primary">
            {t.landing.ctaStart}
          </Link>
          <Link href="/sign-in" className="btn">
            {t.landing.ctaSignIn}
          </Link>
        </div>
      </section>

      <section className="public-features">
        {t.landing.features.map((f) => (
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
