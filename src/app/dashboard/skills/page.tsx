import type { ApprovalPolicy } from '@prisma/client';
import Link from 'next/link';
import { Suspense } from 'react';
import { requireTenant } from '@/lib/auth-context';
import { listClientsInTx } from '@/lib/clients';
import type { Dictionary, Locale } from '@/lib/i18n';
import { getI18n } from '@/lib/i18n/server';
import { getApprovalPolicies } from '@/lib/policies';
import { listSkills } from '@/lib/skills';
import { GUARDRAIL_LIMIT_EUR } from '@/lib/skills/catalog/beleg_kontieren';
import { RECHNUNG_GUARDRAIL_LIMIT_EUR } from '@/lib/skills/catalog/rechnung_erstellen';
import type { SkillDef } from '@/lib/skills';
import { withTenant } from '@/lib/tenant';
import { formatEuro } from '../ui';
import { FlashBanner } from '../flash';
import { startSkillRun } from './actions';

export const dynamic = 'force-dynamic';

function guardrailInfo(
  skill: SkillDef,
  policy: ApprovalPolicy | null,
  g: Dictionary['skills']['guardrail'],
  locale: Locale,
): string {
  if (policy) {
    if (policy.mode === 'always') return g.policyAlways;
    if (policy.mode === 'threshold' && policy.thresholdAmount) {
      return g.policyThreshold(formatEuro(policy.thresholdAmount.toNumber(), locale));
    }
    if (policy.mode === 'never') {
      return skill.handlesMoney ? g.policyNeverMoney : g.policyNever;
    }
  }
  if (skill.key === 'beleg_kontieren') {
    return g.receiptThreshold(formatEuro(GUARDRAIL_LIMIT_EUR, locale));
  }
  if (skill.key === 'rechnung_erstellen') {
    return g.invoiceThreshold(formatEuro(RECHNUNG_GUARDRAIL_LIMIT_EUR, locale));
  }
  if (skill.key === 'angebot_erstellen') {
    return g.quoteAlways;
  }
  if (
    skill.key === 'transkript_zu_framework' ||
    skill.key === 'transkript_zu_use_cases' ||
    skill.key === 'transkript_zu_briefing' ||
    skill.key === 'linear_kommentar'
  ) {
    return g.guardrailActive;
  }
  if (skill.guardrail) return g.guardrailActive;
  return skill.handlesMoney ? g.moneyAlways : g.noneNeeded;
}

function SkillFields({
  skillKey,
  f,
}: {
  skillKey: string;
  f: Dictionary['skills']['forms'];
}) {
  if (skillKey === 'beleg_kontieren') {
    return (
      <>
        <label htmlFor={`besch-${skillKey}`}>{f.description}</label>
        <input
          id={`besch-${skillKey}`}
          name="beschreibung"
          placeholder={f.descriptionPlaceholder}
          required
        />
        <label htmlFor={`betrag-${skillKey}`}>{f.amountEur}</label>
        <input
          id={`betrag-${skillKey}`}
          name="betragEur"
          type="number"
          step="0.01"
          min="0.01"
          placeholder={f.amountPlaceholder}
          required
        />
        <label htmlFor={`beleg-${skillKey}`}>{f.receiptNumber}</label>
        <input id={`beleg-${skillKey}`} name="belegNummer" placeholder="B-2026-…" />
      </>
    );
  }
  if (skillKey === 'wissen_zusammenfassen') {
    return (
      <>
        <label htmlFor={`frage-${skillKey}`}>{f.questionTopic}</label>
        <input
          id={`frage-${skillKey}`}
          name="frage"
          placeholder={f.questionPlaceholder}
          required
        />
      </>
    );
  }
  if (skillKey === 'angebot_erstellen') {
    return (
      <>
        <label htmlFor={`kunde-${skillKey}`}>{f.customer}</label>
        <input
          id={`kunde-${skillKey}`}
          name="kunde"
          placeholder={f.customerPlaceholderQuote}
          required
        />
        <label htmlFor={`leistung-${skillKey}`}>{f.service}</label>
        <input
          id={`leistung-${skillKey}`}
          name="leistung"
          placeholder={f.servicePlaceholder}
          required
        />
        <label htmlFor={`betrag-${skillKey}`}>{f.amountEur}</label>
        <input
          id={`betrag-${skillKey}`}
          name="betragEur"
          type="number"
          step="0.01"
          min="0.01"
          placeholder={f.quoteAmountPlaceholder}
          required
        />
        <label htmlFor={`email-${skillKey}`}>{f.recipientEmail}</label>
        <input
          id={`email-${skillKey}`}
          name="email"
          type="email"
          placeholder={f.emailPlaceholderQuote}
        />
      </>
    );
  }
  if (skillKey === 'rechnung_erstellen') {
    return (
      <>
        <label htmlFor={`kunde-${skillKey}`}>{f.customer}</label>
        <input
          id={`kunde-${skillKey}`}
          name="kunde"
          placeholder={f.customerPlaceholderInvoice}
          required
        />
        <label htmlFor={`pos-${skillKey}`}>{f.positions}</label>
        <textarea
          id={`pos-${skillKey}`}
          name="positionen"
          rows={3}
          placeholder={f.positionsPlaceholder}
          required
        />
        <label htmlFor={`email-${skillKey}`}>{f.recipientEmail}</label>
        <input
          id={`email-${skillKey}`}
          name="email"
          type="email"
          placeholder={f.emailPlaceholderInvoice}
        />
      </>
    );
  }
  if (
    skillKey === 'transkript_zu_framework' ||
    skillKey === 'transkript_zu_use_cases' ||
    skillKey === 'transkript_zu_briefing'
  ) {
    return (
      <>
        <label htmlFor={`thema-${skillKey}`}>{f.topic}</label>
        <input
          id={`thema-${skillKey}`}
          name="thema"
          placeholder={f.topicPlaceholder}
          required
        />
        <label htmlFor={`fokus-${skillKey}`}>{f.focus}</label>
        <input id={`fokus-${skillKey}`} name="fokus" placeholder={f.focusPlaceholder} />
      </>
    );
  }
  if (skillKey === 'linear_kommentar') {
    return (
      <>
        <label htmlFor={`issue-${skillKey}`}>{f.linearIssueId}</label>
        <input
          id={`issue-${skillKey}`}
          name="issueId"
          placeholder={f.linearIssueIdPlaceholder}
          required
        />
        <label htmlFor={`body-${skillKey}`}>{f.linearCommentBody}</label>
        <textarea
          id={`body-${skillKey}`}
          name="body"
          rows={4}
          placeholder={f.linearCommentPlaceholder}
          required
        />
      </>
    );
  }
  return (
    <>
      <label htmlFor={`input-${skillKey}`}>{f.inputJson}</label>
      <textarea id={`input-${skillKey}`} name="inputJson" rows={4} defaultValue="{}" />
    </>
  );
}

export default async function SkillsPage() {
  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const f = t.skills.forms;
  const skills = listSkills();
  const [policies, clients] = await Promise.all([
    getApprovalPolicies(
      orgId,
      skills.map((s) => s.key),
    ),
    withTenant(orgId, (tx) => listClientsInTx(tx)),
  ]);

  return (
    <>
      <p className="page-intro">{t.skills.intro}</p>
      <Suspense fallback={null}>
        <FlashBanner successLabel={t.flash.success} errorLabel={t.flash.error} />
      </Suspense>

      <div className="quick-grid">
        {skills.map((skill) => {
          const acts = skill.steps.some((s) => s.acts);
          const title = t.skillTitles[skill.key] ?? skill.title;
          const description =
            t.skills.descriptions[skill.key] ?? skill.title;
          return (
            <section className="card skill-card" key={skill.key}>
              <div className="skill-head">
                <strong>{title}</strong>
                <span className={`chip chip--dot ${acts ? 'chip--orange' : 'chip--indigo'}`}>
                  {acts ? t.skills.acts : t.skills.readsOnly}
                </span>
                <span className="chip">{skill.key}</span>
              </div>
              <p className="muted" style={{ margin: '0.4rem 0 0.55rem', fontSize: '0.9rem' }}>
                {description}
              </p>
              <div className="skill-guardrail">
                <span>
                  {guardrailInfo(skill, policies.get(skill.key) ?? null, t.skills.guardrail, locale)}
                </span>
              </div>

              {/* Catalog-then-start: closed by default via <details> */}
              <details style={{ marginTop: '0.75rem' }}>
                <summary
                  style={{ cursor: 'pointer', fontWeight: 600, listStyle: 'none' }}
                  className="btn btn--primary"
                >
                  {t.skills.openForm}
                </summary>
                <hr className="skill-divider" />
                <form action={startSkillRun}>
                  <input type="hidden" name="skillKey" value={skill.key} />
                  <SkillFields skillKey={skill.key} f={f} />
                  {clients.length > 0 ? (
                    <>
                      <label htmlFor={`client-${skill.key}`}>{f.clientSelect}</label>
                      <select id={`client-${skill.key}`} name="clientId" defaultValue="">
                        <option value="">{f.clientNone}</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <p
                      className="muted"
                      style={{ margin: '0.25rem 0 0.7rem', fontSize: '0.85rem' }}
                    >
                      {f.clientEmptyHint}{' '}
                      <Link href="/dashboard/settings?tab=clients">{f.clientEmptyLink}</Link>.
                    </p>
                  )}
                  <label
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'flex-start',
                      fontWeight: 'normal',
                      cursor: 'pointer',
                      margin: '0.25rem 0 0.7rem',
                    }}
                  >
                    <input type="checkbox" name="dryRun" style={{ marginTop: '0.2rem' }} />
                    <span>
                      {t.skills.dryRun.toggle}
                      <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                        {t.skills.dryRun.hint}
                      </span>
                    </span>
                  </label>
                  <button type="submit" className="btn btn--primary">
                    {t.common.execute}
                  </button>
                </form>
              </details>
            </section>
          );
        })}
      </div>
    </>
  );
}
