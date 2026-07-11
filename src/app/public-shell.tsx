// Gemeinsamer Rahmen der ÖFFENTLICHEN Seiten (Landing + Rechtsseiten):
// schlanker Header mit Login-CTA + Sprach-Umschalter, Inhalt, Footer mit
// Pflicht-Links. Bewusst ohne Dashboard-Chrome — diese Seiten sieht man vor
// dem Login. Sprache: UI-Cookie (Default Englisch); die Footer-Links zeigen
// je Sprache auf die passende Fassung der Rechtstexte.
import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { HelixMark } from './brand';
import { LanguageSwitcher } from './language-switcher';

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();

  return (
    <div className="public-page">
      <header className="public-header">
        <Link href="/" className="public-logo">
          <HelixMark size={26} variant="light" />
          <span>
            helix<span className="dot">.ai</span>
          </span>
        </Link>
        <nav style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <LanguageSwitcher />
          <Link href="/sign-in" className="btn btn--primary">
            {t.publicShell.signIn}
          </Link>
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <span className="muted">© {new Date().getFullYear()} helix.ai · pilot stage</span>
        <nav className="public-footer-links">
          {/* Legal pages remain reachable by URL but are not primary nav until
              firm identity is filled (no yellow placeholders in the pitch path). */}
          <a href="mailto:pilot@helix.ai">pilot@helix.ai</a>
          <Link href="/pilot">{locale === 'de' ? 'Pilot' : 'Pilot'}</Link>
        </nav>
      </footer>
    </div>
  );
}

/** Deutlich markierter Platzhalter — wird beim Befüllen der Rechtstexte
 * ersetzt; bis dahin ist unübersehbar, dass hier echter Inhalt fehlt. */
export function LegalPlaceholder({ children }: { children: React.ReactNode }) {
  return <mark className="legal-placeholder">[{children}]</mark>;
}
