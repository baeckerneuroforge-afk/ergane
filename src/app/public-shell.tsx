// Gemeinsamer Rahmen der ÖFFENTLICHEN Seiten (Landing + Rechtsseiten):
// schlanker Header mit Login-CTA, Inhalt, Footer mit Pflicht-Links.
// Bewusst ohne Dashboard-Chrome — diese Seiten sieht man vor dem Login.
import Link from 'next/link';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page">
      <header className="public-header">
        <Link href="/" className="public-logo">
          ergane<span className="dot">.</span>
        </Link>
        <nav>
          <Link href="/sign-in" className="btn btn--primary">
            Anmelden
          </Link>
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <span className="muted">© {new Date().getFullYear()} ergane</span>
        <nav className="public-footer-links">
          <Link href="/impressum">Impressum</Link>
          <Link href="/datenschutz">Datenschutz</Link>
          <Link href="/avv">AV-Vertrag</Link>
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
