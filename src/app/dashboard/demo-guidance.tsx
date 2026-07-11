// Ordered pitch steps for designated demo orgs only (isDemoOrg).
// Isolation is listed only when the session is allowlisted (same gate as the page).
import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n';

type StepKey = keyof Dictionary['demoGuidance']['steps'];

const CORE_STEPS: Array<{ href: string; key: StepKey }> = [
  { href: '/dashboard/knowledge', key: 'knowledge' },
  { href: '/dashboard/chat', key: 'chat' },
  { href: '/dashboard/skills', key: 'skills' },
  { href: '/dashboard/approvals', key: 'approvals' },
  { href: '/dashboard/clients', key: 'clients' },
];

const ISOLATION_STEP: { href: string; key: StepKey } = {
  href: '/demo/isolation',
  key: 'isolation',
};

export function DemoGuidanceCard({
  dict,
  includeIsolation = true,
}: {
  dict: Dictionary['demoGuidance'];
  /** When false, hide the isolation step (non-demo org should never see this card). */
  includeIsolation?: boolean;
}) {
  const steps = includeIsolation ? [...CORE_STEPS, ISOLATION_STEP] : CORE_STEPS;

  return (
    <section className="card" style={{ borderColor: 'var(--indigo)', background: 'var(--indigo-bg, #eef2ff)' }}>
      <div className="card-title" style={{ marginBottom: '0.4rem' }}>
        <h2 style={{ margin: 0 }}>{dict.title}</h2>
      </div>
      <p className="muted" style={{ marginTop: 0, padding: '0 1.3rem' }}>
        {dict.intro}
      </p>
      <ol style={{ margin: '0.5rem 1.3rem 1rem', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
        {steps.map((step, i) => (
          <li key={step.href}>
            <strong>
              {i + 1}. {dict.steps[step.key].label}
            </strong>
            {' — '}
            <Link href={step.href}>{dict.steps[step.key].cta}</Link>
            <span className="muted"> · {dict.steps[step.key].hint}</span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ padding: '0 1.3rem 1rem', fontSize: '0.85rem', margin: 0 }}>
        {dict.footer}
      </p>
    </section>
  );
}
