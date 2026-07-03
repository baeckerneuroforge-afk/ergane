'use client';

// Tiny EN/DE toggle for the public pages: submits the setUiLocale server
// action (cookie) — the page re-renders in the chosen language.
import { setUiLocale } from '@/lib/i18n/actions';
import { LOCALES, type Locale } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n/client';

const LABEL: Record<Locale, string> = { en: 'EN', de: 'DE' };

export function LanguageSwitcher() {
  const active = useLocale();
  return (
    <form action={setUiLocale} style={{ display: 'inline-flex', gap: '0.25rem' }} aria-label="Language">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          className={`btn btn--ghost select--inline${locale === active ? ' active' : ''}`}
          style={locale === active ? { fontWeight: 700 } : undefined}
          aria-pressed={locale === active}
        >
          {LABEL[locale]}
        </button>
      ))}
    </form>
  );
}
