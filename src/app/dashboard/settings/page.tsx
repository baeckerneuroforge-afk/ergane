// Admin settings — the UI over the EXISTING governance backend. Reads go
// through withTenant (RLS), every mutation delegates to src/lib/policies/
// (admin gate + audit live there). Non-admins never reach this page: the
// sidebar hides it AND this page redirects — but the policy functions'
// server-side check stays the actual truth.
import type { DocumentVisibility, Role } from '@prisma/client';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { requireTenant } from '@/lib/auth-context';
import { FlashBanner } from '../flash';
import { LOCALES, isLocale, type Dictionary } from '@/lib/i18n';
import { setUiLocale } from '@/lib/i18n/actions';
import { getI18n } from '@/lib/i18n/server';
import { withTenant } from '@/lib/tenant';
import { listSkills } from '@/lib/skills';
import { getValueSettings, DEFAULT_HOURLY_RATE_USD } from '@/lib/value';
import { VisibilityBadge, formatEuro } from '../ui';
import { POLICY_PRESETS } from '@/lib/policies';
import { DEFAULT_LOOP_AUTONOMY, LOOP_AUTONOMY_LEVELS, shouldAutoStart } from '@/lib/loop/settings';
import { MAX_AUTO_CORRECTIONS_PER_DAY } from '@/lib/loop/auto-correct';
import { METRIC_THRESHOLDS } from '@/lib/loop/metrics';
import { frameworkCriteria } from '@/lib/loop/criteria/framework';
import { useCasesCriteria } from '@/lib/loop/criteria/use_cases';
import {
  parseCriteriaOverrides,
  parseMetricThresholdOverrides,
  resolveMetricThreshold,
} from '@/lib/loop/thresholds';
import {
  addClient,
  editClient,
  removeClient,
  applyGovernancePreset,
  eraseOrganization,
  importGovernanceConfig,
  purgeChat,
  saveApprovalNotifyEmail,
  saveChatRetention,
  saveCompanyProfile,
  saveLoopAutonomy,
  saveLoopCriteriaOverrides,
  saveLoopMetricThresholds,
  saveOrgLocale,
  saveValueSettings,
  removeSlackUserLink,
  saveApprovalPolicy,
  saveMembershipRole,
  saveSlackInstallation,
  saveSlackUserLink,
  saveVisibilityGrants,
} from './actions';

export const dynamic = 'force-dynamic';

// Tab keys are stable URL identifiers (English), independent of the UI
// language — deep links like ?tab=company work in every locale.
const TAB_KEYS = [
  'approvals',
  'visibility',
  'members',
  'clients',
  'governance',
  'company',
  'value',
  'slack',
  'loop',
  'language',
  'data',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

// Mirrors the matrix the saveVisibilityGrants action writes.
const GRANT_LEVELS: DocumentVisibility[] = ['restricted', 'confidential'];
const GRANT_ROLES: Role[] = ['member', 'lead', 'admin'];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  lead: 'Lead',
  member: 'Member',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId, role } = await requireTenant();
  if (role !== 'admin' && role !== 'owner') redirect('/dashboard');

  const params = await searchParams;
  const tab: TabKey = TAB_KEYS.some((t) => t === params.tab) ? (params.tab as TabKey) : 'approvals';

  const { locale, t } = await getI18n();
  const s = t.settings;

  const levelExplanation: Array<{ level: DocumentVisibility; text: string }> = [
    { level: 'open', text: s.levelOpen },
    { level: 'restricted', text: s.levelRestricted },
    { level: 'confidential', text: s.levelConfidential },
  ];

  const skills = listSkills();
  const {
    policies,
    grants,
    documents,
    memberships,
    clients,
    slackInstallations,
    slackLinks,
    orgSettings,
    valueSettings,
  } = await withTenant(orgId, async (tx) => ({
      policies: await tx.approvalPolicy.findMany(),
      grants: await tx.visibilityGrant.findMany(),
      documents: await tx.document.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      memberships: await tx.membership.findMany({ orderBy: { createdAt: 'asc' } }),
      clients: await tx.client.findMany({ orderBy: { name: 'asc' } }),
      slackInstallations: await tx.slackInstallation.findMany({ orderBy: { createdAt: 'asc' } }),
      slackLinks: await tx.slackUserLink.findMany({ orderBy: { createdAt: 'asc' } }),
      orgSettings: await tx.orgSettings.findUnique({ where: { orgId } }),
      valueSettings: await getValueSettings(tx, orgId),
    }));

  const granted = new Set(grants.map((g) => `${g.level}:${g.role}`));
  const adminCount = memberships.filter((m) => m.role === 'admin' || m.role === 'owner').length;
  const rawOrgLocale = orgSettings?.locale;
  const orgLocale = isLocale(rawOrgLocale) ? rawOrgLocale : 'en';

  // Loop tab: autonomy + editable metric thresholds / criteria overrides.
  const loopAutonomy = orgSettings?.loopAutonomy ?? DEFAULT_LOOP_AUTONOMY;
  const metricOverrides = parseMetricThresholdOverrides(orgSettings?.loopMetricThresholds);
  const criteriaOverrides = parseCriteriaOverrides(orgSettings?.loopCriteriaOverrides);
  const loopMetricRows = (
    Object.keys(METRIC_THRESHOLDS) as Array<keyof typeof METRIC_THRESHOLDS>
  ).map((key) => {
    const { threshold, direction } = resolveMetricThreshold(key, METRIC_THRESHOLDS, metricOverrides);
    const defaultThr = METRIC_THRESHOLDS[key].threshold;
    const isRate = defaultThr <= 1;
    return {
      key,
      direction,
      threshold,
      isRate,
      // Form shows rates as percent for human editing.
      formValue: isRate ? Math.round(threshold * 100) : threshold,
      targetLabel: isRate ? `${Math.round(threshold * 100)}%` : String(threshold),
    };
  });
  const localeLabel: Record<string, string> = {
    en: s.languageEnglish,
    de: s.languageGerman,
  };

  return (
    <>
      <p className="page-intro">
        {s.intro} <Link href="/dashboard/audit">{s.introAuditLink}</Link>.
      </p>
      <Suspense fallback={null}>
        <FlashBanner successLabel={t.flash.success} errorLabel={t.flash.error} />
      </Suspense>

      <nav className="tabs" aria-label={s.tabsAria}>
        {TAB_KEYS.map((key) => (
          <Link
            key={key}
            href={`/dashboard/settings?tab=${key}`}
            className={`tab${key === tab ? ' active' : ''}`}
          >
            {s.tabs[key]}
          </Link>
        ))}
      </nav>

      {tab === 'approvals' ? (
        <>
        <section className="card">
          <h2>{s.notifyTitle}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {s.notifyHint}
          </p>
          <form action={saveApprovalNotifyEmail}>
            <input
              name="notifyEmail"
              type="email"
              maxLength={320}
              defaultValue={orgSettings?.approvalNotifyEmail ?? ''}
              placeholder={s.notifyPlaceholder}
              className="select--inline"
              style={{ width: '18rem' }}
            />{' '}
            <button type="submit" className="btn btn--primary select--inline">
              {t.common.save}
            </button>
          </form>
        </section>
        <section className="card card--table">
          <div className="card-title">
            <h2>{s.policiesTitle}</h2>
          </div>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            <span className="chip chip--amber">{s.failsafeChip}</span> {s.policiesFailsafe}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.skill}</th>
                <th>{s.currentRule}</th>
                <th>{s.mode}</th>
                <th>{s.threshold}</th>
                <th>{s.approverRole}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => {
                const policy = policies.find((p) => p.skillKey === skill.key) ?? null;
                return (
                  <tr key={skill.key}>
                    <td>
                      <strong>{t.skillTitles[skill.key] ?? skill.title}</strong>
                      <div className="row-meta mono">{skill.key}</div>
                      {skill.handlesMoney ? (
                        <span className="chip chip--orange" title={s.movesMoneyTitle}>
                          {s.movesMoney}
                        </span>
                      ) : null}
                    </td>
                    <td className="row-meta">
                      {policy
                        ? policy.mode === 'threshold' && policy.thresholdAmount
                          ? s.ruleFrom(formatEuro(policy.thresholdAmount.toNumber(), locale))
                          : policy.mode === 'always'
                            ? s.ruleAlways
                            : skill.handlesMoney
                              ? s.ruleNeverFailsafe
                              : s.ruleNever
                        : s.ruleNoPolicy}
                    </td>
                    <FormCells
                      skillKey={skill.key}
                      defaultMode={policy?.mode ?? 'always'}
                      defaultThreshold={policy?.thresholdAmount?.toNumber() ?? null}
                      defaultApprover={policy?.approverRole ?? 'lead'}
                      dict={s}
                      saveLabel={t.common.save}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        </>
      ) : null}

      {tab === 'visibility' ? (
        <>
          <section className="card">
            <h2>{s.visibilityLevelsTitle}</h2>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem' }}>
              {levelExplanation.map(({ level, text }) => (
                <li key={level}>
                  <VisibilityBadge visibility={level} /> <span className="row-meta">{text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>{s.grantsTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.grantsHint}
            </p>
            <form action={saveVisibilityGrants}>
              <table className="table" style={{ maxWidth: '32rem' }}>
                <thead>
                  <tr>
                    <th>{s.level}</th>
                    {GRANT_ROLES.map((r) => (
                      <th key={r}>{ROLE_LABEL[r]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GRANT_LEVELS.map((level) => (
                    <tr key={level}>
                      <td>
                        <VisibilityBadge visibility={level} />
                      </td>
                      {GRANT_ROLES.map((r) => (
                        <td key={r}>
                          <input
                            type="checkbox"
                            name={`grant:${level}:${r}`}
                            aria-label={s.grantAria(level, ROLE_LABEL[r] ?? r)}
                            defaultChecked={granted.has(`${level}:${r}`)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="submit" className="btn btn--primary" style={{ marginTop: '0.6rem' }}>
                {s.saveGrants}
              </button>
            </form>
          </section>

          <section className="card card--table">
            <div className="card-title">
              <h2>{s.documentsLevelTitle}</h2>
            </div>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              {s.documentsLevelHint}{' '}
              <Link href="/dashboard/knowledge">{s.documentsLevelLink}</Link>.
            </p>
            {documents.length === 0 ? (
              <p className="muted" style={{ padding: '0 1.25rem 0.8rem' }}>{s.noDocuments}</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.common.title}</th>
                    <th>{t.common.visibility}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.title}</td>
                      <td>
                        <VisibilityBadge visibility={doc.visibility} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}

      {tab === 'members' ? (
        <section className="card card--table">
          <div className="card-title">
            <h2>{s.membersHeading}</h2>
            <span className="row-meta">{s.membersTotal(memberships.length)}</span>
          </div>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            {s.membersHint}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>{s.memberId}</th>
                <th>{t.common.role}</th>
                <th>{s.changeRole}</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => {
                const isAdminTier = m.role === 'admin' || m.role === 'owner';
                const lastAdmin = isAdminTier && adminCount <= 1;
                return (
                  <tr key={m.id}>
                    <td className="mono">{m.userId}</td>
                    <td>
                      <span className={`chip ${isAdminTier ? 'chip--indigo' : 'chip--gray'}`}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                      {lastAdmin ? <span className="chip chip--amber">{s.lastAdmin}</span> : null}
                    </td>
                    <td>
                      {m.role === 'owner' ? (
                        <span className="row-meta">{s.ownerManual}</span>
                      ) : (
                        <form action={saveMembershipRole} style={{ display: 'inline-block' }}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <select name="role" defaultValue={m.role} className="select--inline">
                            <option value="member">member</option>
                            <option value="lead">lead</option>
                            <option value="admin">admin</option>
                          </select>{' '}
                          <button type="submit" className="btn btn--ghost select--inline">
                            {t.common.change}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'clients' ? (
        <section className="card card--table">
          <div className="card-title">
            <h2>{s.clientsHeading}</h2>
            <span className="row-meta">{s.clientsTotal(clients.length)}</span>
          </div>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            {s.clientsHint}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>{s.clientName}</th>
                <th>{s.clientNotes}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    {s.noClients}
                  </td>
                </tr>
              ) : null}
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      name="clientName"
                      defaultValue={c.name}
                      required
                      className="select--inline"
                      form={`edit-client-${c.id}`}
                      style={{ width: '14rem' }}
                    />
                  </td>
                  <td>
                    <input
                      name="clientNotes"
                      defaultValue={c.notes ?? ''}
                      className="select--inline"
                      form={`edit-client-${c.id}`}
                      style={{ width: '18rem' }}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <form id={`edit-client-${c.id}`} action={editClient}>
                      <input type="hidden" name="clientId" value={c.id} />
                    </form>
                    <button
                      type="submit"
                      className="btn btn--ghost select--inline"
                      form={`edit-client-${c.id}`}
                    >
                      {s.saveClient}
                    </button>{' '}
                    <form action={removeClient} style={{ display: 'inline' }}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <button type="submit" className="btn btn--ghost select--inline">
                        {s.deleteClient}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    name="clientName"
                    placeholder={s.clientNamePlaceholder}
                    required
                    className="select--inline"
                    form="add-client-form"
                    style={{ width: '14rem' }}
                  />
                </td>
                <td>
                  <input
                    name="clientNotes"
                    placeholder={s.clientNotesPlaceholder}
                    className="select--inline"
                    form="add-client-form"
                    style={{ width: '18rem' }}
                  />
                </td>
                <td>
                  <form id="add-client-form" action={addClient} />
                  <button
                    type="submit"
                    className="btn btn--primary select--inline"
                    form="add-client-form"
                  >
                    {s.addClient}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'governance' ? (
        <>
          <section className="card">
            <h2>{s.governance.presetsTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.governance.presetsHint}
            </p>
            <p className="muted">
              <span className="chip chip--amber">{s.failsafeChip}</span>{' '}
              {s.governance.moneyFailsafeNote}
            </p>
            <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
              {POLICY_PRESETS.map((preset) => (
                <div key={preset.key} className="card" style={{ margin: 0 }}>
                  <h3 style={{ marginTop: 0 }}>
                    {s.governance.presetNames[preset.key] ?? preset.key}
                  </h3>
                  <p className="row-meta">
                    {s.governance.appliesTo(
                      preset.approvalPolicies.length,
                      preset.visibilityGrants.length,
                    )}
                  </p>
                  <p className="muted">{s.governance.presetDescriptions[preset.key]}</p>
                  <form action={applyGovernancePreset}>
                    <input type="hidden" name="presetKey" value={preset.key} />
                    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                      <input type="checkbox" name="confirmOverwrite" required />
                      <span className="row-meta">{s.governance.confirmOverwrite}</span>
                    </label>
                    <button type="submit" className="btn btn--primary" style={{ marginTop: '0.6rem' }}>
                      {s.governance.applyCta}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>{s.governance.exportTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.governance.exportHint}
            </p>
            <a className="btn btn--primary" href="/dashboard/settings/governance" download>
              {s.governance.exportCta}
            </a>
          </section>

          <section className="card">
            <h2>{s.governance.importTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.governance.importHint}
            </p>
            <form action={importGovernanceConfig}>
              <textarea
                name="governanceJson"
                rows={6}
                placeholder={s.governance.importPlaceholder}
                className="mono"
                style={{ width: '100%' }}
              />
              <p className="row-meta" style={{ margin: '0.4rem 0' }}>
                {s.governance.importFileLabel}{' '}
                <input type="file" name="governanceFile" accept="application/json,.json" />
              </p>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <input type="checkbox" name="confirmOverwrite" required />
                <span className="row-meta">{s.governance.confirmOverwrite}</span>
              </label>
              <button type="submit" className="btn btn--primary" style={{ marginTop: '0.6rem' }}>
                {s.governance.importCta}
              </button>
            </form>
          </section>
        </>
      ) : null}

      {tab === 'company' ? (
        <section className="card">
          <h2>{s.companyTitle}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {s.companyHint}
          </p>
          <form action={saveCompanyProfile}>
            <label htmlFor="companyName">{s.companyName}</label>
            <input
              id="companyName"
              name="companyName"
              maxLength={200}
              defaultValue={orgSettings?.companyName ?? ''}
              placeholder={s.companyNamePlaceholder}
            />
            <label htmlFor="companyAddress">{s.companyAddress}</label>
            <textarea
              id="companyAddress"
              name="companyAddress"
              rows={3}
              maxLength={500}
              defaultValue={orgSettings?.companyAddress ?? ''}
              placeholder={s.companyAddressPlaceholder}
            />
            <label htmlFor="companyVatId">{s.companyVatId}</label>
            <input
              id="companyVatId"
              name="companyVatId"
              maxLength={50}
              defaultValue={orgSettings?.companyVatId ?? ''}
              placeholder={s.companyVatIdPlaceholder}
            />
            <label htmlFor="companyBank">{s.companyBank}</label>
            <textarea
              id="companyBank"
              name="companyBank"
              rows={3}
              maxLength={500}
              defaultValue={orgSettings?.companyBank ?? ''}
              placeholder={s.companyBankPlaceholder}
            />
            <button type="submit" className="btn btn--primary">
              {t.common.save}
            </button>
          </form>
        </section>
      ) : null}

      {tab === 'value' ? (
        <section className="card card--table">
          <div className="card-title">
            <h2>{s.valueTitle}</h2>
          </div>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            {s.valueHint}
          </p>
          <form action={saveValueSettings}>
            <div style={{ padding: '0 1.25rem' }}>
              <label htmlFor="hourlyRateUsd">{s.valueHourlyRate}</label>
              <input
                id="hourlyRateUsd"
                name="hourlyRateUsd"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={valueSettings.hourlyRateUsd}
                placeholder={String(DEFAULT_HOURLY_RATE_USD)}
                className="select--inline"
                style={{ width: '8rem' }}
                required
              />
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.skill}</th>
                  <th>{s.valueMinutes}</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.key}>
                    <td>
                      <strong>{t.skillTitles[skill.key] ?? skill.title}</strong>
                      <div className="row-meta mono">{skill.key}</div>
                    </td>
                    <td>
                      <input
                        name={`minutes:${skill.key}`}
                        type="number"
                        step="1"
                        min="0"
                        defaultValue={valueSettings.minutesPerSkill[skill.key]}
                        aria-label={`${s.valueMinutes} — ${skill.key}`}
                        className="select--inline"
                        style={{ width: '7rem' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '0 1.25rem 1rem' }}>
              <button type="submit" className="btn btn--primary">
                {t.common.save}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {tab === 'slack' ? (
        <>
          <section className="card">
            <h2>{s.slackTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.slackHint}
            </p>
            {slackInstallations.length > 0 ? (
              <p>
                <span className="chip chip--indigo">{s.slackConnected}</span>{' '}
                {s.slackTeam}{' '}
                {slackInstallations.map((i) => (
                  <code key={i.id} className="mono" style={{ marginRight: '0.4rem' }}>
                    {i.slackTeamId}
                  </code>
                ))}
              </p>
            ) : (
              <form action={saveSlackInstallation}>
                <p>
                  <span className="chip chip--gray">{s.slackNotConnected}</span>{' '}
                  <a className="btn btn--primary select--inline" href="/api/slack/oauth/start">
                    {s.slackOauthCta}
                  </a>{' '}
                  <span className="row-meta">{s.slackManualHint}</span>
                </p>
                <input
                  name="slackTeamId"
                  placeholder={s.slackTeamIdPlaceholder}
                  className="select--inline"
                  style={{ width: '16rem' }}
                  required
                />{' '}
                <button type="submit" className="btn btn--primary select--inline">
                  {s.slackConnect}
                </button>
              </form>
            )}
          </section>

          <section className="card card--table">
            <div className="card-title">
              <h2>{s.slackLinksHeading}</h2>
              <span className="row-meta">{s.slackLinkedCount(slackLinks.length)}</span>
            </div>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              {s.slackLinksHint}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>{s.slackUserId}</th>
                  <th>{s.member}</th>
                  <th>{t.common.role}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slackLinks.map((link) => {
                  const member = memberships.find((m) => m.userId === link.userId);
                  return (
                    <tr key={link.id}>
                      <td className="mono">{link.slackUserId}</td>
                      <td className="mono">{link.userId}</td>
                      <td>
                        <span className="chip chip--gray">
                          {member ? (ROLE_LABEL[member.role] ?? member.role) : '—'}
                        </span>
                      </td>
                      <td>
                        <form action={removeSlackUserLink} style={{ display: 'inline-block' }}>
                          <input type="hidden" name="slackUserId" value={link.slackUserId} />
                          <button type="submit" className="btn btn--ghost select--inline">
                            {s.unlink}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <input
                      name="slackUserId"
                      placeholder={s.slackUserIdPlaceholder}
                      className="select--inline"
                      form="slack-link-form"
                      required
                    />
                  </td>
                  <td colSpan={2}>
                    <form id="slack-link-form" action={saveSlackUserLink} />
                    <select name="userId" className="select--inline" form="slack-link-form">
                      {memberships.map((m) => (
                        <option key={m.id} value={m.userId}>
                          {m.userId} ({m.role})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="submit"
                      className="btn btn--primary select--inline"
                      form="slack-link-form"
                    >
                      {s.link}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {tab === 'loop' ? (
        <>
          <section className="card">
            <h2>{s.loop.autonomyTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.loop.autonomyHint}
            </p>
            <form action={saveLoopAutonomy}>
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {LOOP_AUTONOMY_LEVELS.map((level) => {
                  const label =
                    level === 'report'
                      ? s.loop.levelReport
                      : level === 'suggest'
                        ? s.loop.levelSuggest
                        : s.loop.levelAutonomous;
                  const desc =
                    level === 'report'
                      ? s.loop.levelReportDesc
                      : level === 'suggest'
                        ? s.loop.levelSuggestDesc
                        : s.loop.levelAutonomousDesc;
                  return (
                    <label
                      key={level}
                      style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}
                    >
                      <input
                        type="radio"
                        name="loopAutonomy"
                        value={level}
                        defaultChecked={loopAutonomy === level}
                        style={{ marginTop: '0.25rem' }}
                      />
                      <span>
                        <strong>{label}</strong>
                        {level === DEFAULT_LOOP_AUTONOMY ? (
                          <span className="chip chip--gray" style={{ marginLeft: '0.4rem' }}>
                            {s.loop.defaultBadge}
                          </span>
                        ) : null}
                        <div className="row-meta">{desc}</div>
                        {shouldAutoStart(level) ? (
                          <div className="row-meta" style={{ marginTop: '0.3rem' }}>
                            <span className="chip chip--amber">{s.loop.autonomousLimits(MAX_AUTO_CORRECTIONS_PER_DAY)}</span>
                          </div>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <button type="submit" className="btn btn--primary" style={{ marginTop: '0.9rem' }}>
                {s.loop.save}
              </button>
            </form>
          </section>

          <section className="card card--table">
            <div className="card-title">
              <h2>{s.loop.thresholdsTitle}</h2>
            </div>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              {s.loop.thresholdsHint}
            </p>
            <form action={saveLoopMetricThresholds}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{s.loop.metric}</th>
                    <th>{s.loop.target}</th>
                    <th>{s.loop.direction}</th>
                  </tr>
                </thead>
                <tbody>
                  {loopMetricRows.map((m) => (
                    <tr key={m.key}>
                      <td>
                        <strong>{s.loop.metricNames[m.key] ?? m.key}</strong>
                        <div className="row-meta mono">{m.key}</div>
                        {m.isRate ? (
                          <div className="row-meta">{s.loop.ratePercentHint}</div>
                        ) : null}
                      </td>
                      <td>
                        <input
                          name={`metric_${m.key}`}
                          type="number"
                          step={m.isRate ? '1' : '0.1'}
                          min="0"
                          defaultValue={m.formValue}
                          style={{ width: '6rem' }}
                          aria-label={s.loop.metricNames[m.key] ?? m.key}
                        />
                      </td>
                      <td className="row-meta">
                        {m.direction === 'atLeast' ? s.loop.atLeast : s.loop.atMost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '0.75rem 1.25rem 1.25rem' }}>
                <button type="submit" className="btn btn--primary">
                  {s.loop.saveThresholds}
                </button>
              </div>
            </form>
          </section>

          <section className="card card--table">
            <div className="card-title">
              <h2>{s.loop.criteriaTitle}</h2>
            </div>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              {s.loop.criteriaHint}
            </p>
            <form action={saveLoopCriteriaOverrides}>
              <div style={{ padding: '0 1.25rem 1rem' }}>
                <h3 style={{ fontSize: '0.95rem' }}>{s.loop.criteriaType(frameworkCriteria.type)}</h3>
                <label htmlFor="framework_min_use_cases">{s.loop.frameworkMinUseCases}</label>
                <input
                  id="framework_min_use_cases"
                  name="framework_min_use_cases"
                  type="number"
                  min="0"
                  defaultValue={criteriaOverrides.framework?.min_use_cases ?? 3}
                />
                <label htmlFor="framework_min_length">{s.loop.frameworkMinLength}</label>
                <input
                  id="framework_min_length"
                  name="framework_min_length"
                  type="number"
                  min="0"
                  defaultValue={criteriaOverrides.framework?.min_length ?? 500}
                />
                <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>
                  {s.loop.criteriaType(useCasesCriteria.type)}
                </h3>
                <label htmlFor="use_cases_min_use_cases">{s.loop.useCasesMinItems}</label>
                <input
                  id="use_cases_min_use_cases"
                  name="use_cases_min_use_cases"
                  type="number"
                  min="0"
                  defaultValue={criteriaOverrides.use_cases?.min_use_cases ?? 3}
                />
                <label htmlFor="use_cases_min_length">{s.loop.useCasesMinLength}</label>
                <input
                  id="use_cases_min_length"
                  name="use_cases_min_length"
                  type="number"
                  min="0"
                  defaultValue={criteriaOverrides.use_cases?.min_length ?? 300}
                />
              </div>
              <div style={{ padding: '0 1.25rem 1.25rem' }}>
                <button type="submit" className="btn btn--primary">
                  {s.loop.saveCriteria}
                </button>
              </div>
            </form>
            <table className="table">
              <thead>
                <tr>
                  <th>{s.loop.criterion}</th>
                </tr>
              </thead>
              <tbody>
                {[...frameworkCriteria.criteria, ...useCasesCriteria.criteria].map((c) => (
                  <tr key={`${c.key}-${c.label}`}>
                    <td>
                      <strong>{c.label}</strong>
                      <div className="row-meta mono">{c.key}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {tab === 'language' ? (
        <>
          <section className="card">
            <h2>{s.uiLanguageTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.uiLanguageHint}
            </p>
            <form action={setUiLocale}>
              <label htmlFor="ui-locale">{s.uiLanguageLabel}</label>
              <select id="ui-locale" name="locale" defaultValue={locale} className="select--inline">
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {localeLabel[l]}
                  </option>
                ))}
              </select>{' '}
              <button type="submit" className="btn btn--primary select--inline">
                {t.common.save}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>{s.orgLanguageTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.orgLanguageHint}
            </p>
            <form action={saveOrgLocale}>
              <label htmlFor="org-locale">{s.orgLanguageLabel}</label>
              <select
                id="org-locale"
                name="locale"
                defaultValue={orgLocale}
                className="select--inline"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {localeLabel[l]}
                  </option>
                ))}
              </select>{' '}
              <button type="submit" className="btn btn--primary select--inline">
                {t.common.save}
              </button>
            </form>
          </section>
        </>
      ) : null}

      {tab === 'data' ? (
        <>
          <section className="card">
            <h2>{s.exportTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.exportHint}
            </p>
            <a className="btn btn--primary" href="/dashboard/settings/export" download>
              {s.exportCta}
            </a>
          </section>

          <section className="card">
            <h2>{s.retentionTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.retentionAutoHint}
            </p>
            <form action={saveChatRetention}>
              <input
                name="retentionDays"
                type="number"
                min="1"
                step="1"
                defaultValue={orgSettings?.chatRetentionDays ?? ''}
                placeholder={s.retentionUnlimited}
                className="select--inline"
                style={{ width: '7rem' }}
              />{' '}
              <span className="row-meta">{s.retentionDaysAuto}</span>{' '}
              <button type="submit" className="btn btn--primary select--inline">
                {t.common.save}
              </button>
            </form>
            <p className="muted" style={{ marginTop: '0.8rem' }}>
              {s.retentionOnceHint}
            </p>
            <form action={purgeChat}>
              <input
                name="olderThanDays"
                type="number"
                min="0"
                step="1"
                defaultValue={90}
                className="select--inline"
                style={{ width: '6rem' }}
              />{' '}
              <span className="row-meta">{s.retentionDays}</span>{' '}
              <button type="submit" className="btn btn--ghost select--inline">
                {s.purgeCta}
              </button>
            </form>
          </section>

          <section className="card" style={{ borderColor: '#c0392b' }}>
            <h2>{s.eraseTitle}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.eraseHint}
            </p>
            <form action={eraseOrganization}>
              <input
                name="confirmName"
                placeholder={s.erasePlaceholder}
                className="select--inline"
                style={{ width: '18rem' }}
                required
              />{' '}
              <button type="submit" className="btn btn--ghost select--inline" style={{ color: '#c0392b' }}>
                {s.eraseCta}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </>
  );
}

/** The editable cells of one approval-policy row (single form via form=id). */
function FormCells({
  skillKey,
  defaultMode,
  defaultThreshold,
  defaultApprover,
  dict,
  saveLabel,
}: {
  skillKey: string;
  defaultMode: string;
  defaultThreshold: number | null;
  defaultApprover: string;
  dict: Dictionary['settings'];
  saveLabel: string;
}) {
  const formId = `policy-${skillKey}`;
  return (
    <>
      <td>
        <form id={formId} action={saveApprovalPolicy}>
          <input type="hidden" name="skillKey" value={skillKey} />
        </form>
        <select name="mode" defaultValue={defaultMode} className="select--inline" form={formId}>
          <option value="always">{dict.modeAlways}</option>
          <option value="threshold">{dict.modeThreshold}</option>
          <option value="never">{dict.modeNever}</option>
        </select>
      </td>
      <td>
        <input
          name="thresholdAmount"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultThreshold ?? undefined}
          placeholder={dict.thresholdPlaceholder}
          className="select--inline"
          style={{ width: '7rem' }}
          form={formId}
        />
      </td>
      <td>
        <select
          name="approverRole"
          defaultValue={defaultApprover}
          className="select--inline"
          form={formId}
        >
          <option value="lead">lead</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td>
        <button type="submit" className="btn btn--ghost select--inline" form={formId}>
          {saveLabel}
        </button>
      </td>
    </>
  );
}
