// "Erste Schritte" — geführter Erststart auf der Übersicht. Rein serverseitig:
// der Fortschritt wird aus echten Daten abgeleitet (kein eigener Zustand,
// nichts zu migrieren) und die Karte verschwindet von selbst, sobald alle
// Schritte erledigt sind.
import Link from 'next/link';

export interface OnboardingProgress {
  hasDocument: boolean;
  hasChatMessage: boolean;
  hasRun: boolean;
  hasCompanyProfile: boolean;
}

interface Step {
  done: boolean;
  title: string;
  hint: string;
  href: string;
  cta: string;
}

export function onboardingComplete(p: OnboardingProgress): boolean {
  return p.hasDocument && p.hasChatMessage && p.hasRun && p.hasCompanyProfile;
}

export function OnboardingCard({ progress }: { progress: OnboardingProgress }) {
  if (onboardingComplete(progress)) return null;

  const steps: Step[] = [
    {
      done: progress.hasDocument,
      title: 'Wissen hochladen',
      hint: 'PDF, DOCX, Markdown oder Text — daraus beantwortet ergane Fragen mit Quellenangabe.',
      href: '/dashboard/knowledge',
      cta: 'Zur Wissensbasis',
    },
    {
      done: progress.hasChatMessage,
      title: 'Erste Frage stellen',
      hint: 'Der Chat antwortet nur aus Ihrem geprüften Wissen — oder sagt ehrlich, dass er es nicht weiß.',
      href: '/dashboard/chat',
      cta: 'Zum Chat',
    },
    {
      done: progress.hasRun,
      title: 'Skill ausprobieren',
      hint: 'Z. B. ein Angebot entwerfen — alles mit externer Wirkung wartet auf Ihre Freigabe.',
      href: '/dashboard/skills',
      cta: 'Zu den Skills',
    },
    {
      done: progress.hasCompanyProfile,
      title: 'Firmendaten hinterlegen',
      hint: 'Name, Anschrift, USt-IdNr., Bank — erscheinen als Briefkopf auf Angebots- und Rechnungs-PDFs.',
      href: '/dashboard/settings?tab=firma',
      cta: 'Zu den Einstellungen',
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <section className="card onboarding">
      <h2>
        Erste Schritte{' '}
        <span className="muted onboarding-count">
          {steps.length - remaining}/{steps.length} erledigt
        </span>
      </h2>
      <ol className="onboarding-steps">
        {steps.map((step) => (
          <li key={step.title} className={step.done ? 'done' : undefined}>
            <span className="onboarding-check" aria-hidden>
              {step.done ? '✓' : '○'}
            </span>
            <div>
              <strong>{step.title}</strong>
              <div className="muted">{step.hint}</div>
            </div>
            {step.done ? null : (
              <Link href={step.href} className="btn btn--primary onboarding-cta">
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
