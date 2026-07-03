// Gemeinsamer Rahmen der ÖFFENTLICHEN Seiten (Landing + Rechtsseiten):
// schlanker Header mit Login-CTA + Sprach-Umschalter, Inhalt, Footer mit
// Pflicht-Links. Bewusst ohne Dashboard-Chrome — diese Seiten sieht man vor
// dem Login. Sprache: UI-Cookie (Default Englisch); die Footer-Links zeigen
// je Sprache auf die passende Fassung der Rechtstexte.
import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { LanguageSwitcher } from './language-switcher';

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const legal =
    locale === 'de'
      ? { imprint: '/impressum', privacy: '/datenschutz', dpa: '/avv' }
      : { imprint: '/imprint', privacy: '/privacy', dpa: '/dpa' };

  return (
    <div className="public-page">
      <header className="public-header">
        <Link href="/" className="public-logo">
          ergane<span className="dot">.</span>
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
        <span className="muted">© {new Date().getFullYear()} ergane</span>
        <nav className="public-footer-links">
          <Link href={legal.imprint}>{t.publicShell.imprint}</Link>
          <Link href={legal.privacy}>{t.publicShell.privacy}</Link>
          <Link href={legal.dpa}>{t.publicShell.dpa}</Link>
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
