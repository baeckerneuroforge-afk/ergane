import './globals.css';
import type { Metadata } from 'next';
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { deDE } from '@clerk/localizations';
import { LocaleProvider } from '@/lib/i18n/client';
import { getLocale } from '@/lib/i18n/server';

// display: 'swap' — text renders immediately in the fallback font instead of
// blocking on the webfont download (no invisible-text phase).
// Rollen: Instrument Sans = Fließtext, Bricolage Grotesque = Überschriften &
// Wortmarke, JetBrains Mono = Daten (IDs, Beträge, Zeitstempel).
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ergane',
  description: 'Tenant-first foundation — isolation enforced by Postgres RLS.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // English is the platform default; the switcher sets the cookie.
  const locale = await getLocale();

  return (
    <ClerkProvider localization={locale === 'de' ? deDE : undefined}>
      <html lang={locale}>
        <body className={`${instrumentSans.variable} ${bricolage.variable} ${jetbrainsMono.variable}`}>
          <LocaleProvider locale={locale}>{children}</LocaleProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
