// Admin settings — the UI over the EXISTING governance backend. Reads go
// through withTenant (RLS), every mutation delegates to src/lib/policies/
// (admin gate + audit live there). Non-admins never reach this page: the
// sidebar hides it AND this page redirects — but the policy functions'
// server-side check stays the actual truth.
import type { DocumentVisibility, Role } from '@prisma/client';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { withTenant } from '@/lib/tenant';
import { listSkills } from '@/lib/skills';
import { VisibilityBadge, formatEuro } from '../ui';
import {
  removeSlackUserLink,
  saveApprovalPolicy,
  saveMembershipRole,
  saveSlackInstallation,
  saveSlackUserLink,
  saveVisibilityGrants,
} from './actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'freigaben', label: 'Freigabe-Regeln' },
  { key: 'sichtbarkeit', label: 'Wissens-Sichtbarkeit' },
  { key: 'mitglieder', label: 'Mitglieder & Rollen' },
  { key: 'slack', label: 'Slack' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Mirrors the matrix the saveVisibilityGrants action writes.
const GRANT_LEVELS: DocumentVisibility[] = ['restricted', 'confidential'];
const GRANT_ROLES: Role[] = ['member', 'lead', 'admin'];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  lead: 'Lead',
  member: 'Member',
};

const LEVEL_EXPLANATION: Array<{ level: DocumentVisibility; text: string }> = [
  { level: 'open', text: 'Alle Rollen sehen diese Dokumente — keine Berechtigung nötig.' },
  {
    level: 'restricted',
    text: 'Nur Rollen mit explizitem Grant. Ohne Grant ist das Dokument in Chat/Retrieval unsichtbar (fail-closed).',
  },
  {
    level: 'confidential',
    text: 'Höchste Stufe — ebenfalls nur per Grant. Auch Admins brauchen einen Grant, sonst sehen sie nichts.',
  },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId, role } = await requireTenant();
  if (role !== 'admin' && role !== 'owner') redirect('/dashboard');

  const params = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : 'freigaben';

  const skills = listSkills();
  const { policies, grants, documents, memberships, slackInstallations, slackLinks } =
    await withTenant(orgId, async (tx) => ({
      policies: await tx.approvalPolicy.findMany(),
      grants: await tx.visibilityGrant.findMany(),
      documents: await tx.document.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      memberships: await tx.membership.findMany({ orderBy: { createdAt: 'asc' } }),
      slackInstallations: await tx.slackInstallation.findMany({ orderBy: { createdAt: 'asc' } }),
      slackLinks: await tx.slackUserLink.findMany({ orderBy: { createdAt: 'asc' } }),
    }));

  const granted = new Set(grants.map((g) => `${g.level}:${g.role}`));
  const adminCount = memberships.filter((m) => m.role === 'admin' || m.role === 'owner').length;

  return (
    <>
      <p className="page-intro">
        Governance der Organisation: Wann braucht ein Skill eine menschliche Freigabe, welche Rolle
        sieht welches Wissen, wer hat welche Rolle. Jede Änderung landet im{' '}
        <Link href="/dashboard/audit">Audit</Link>.
      </p>

      <nav className="tabs" aria-label="Einstellungen">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/settings?tab=${t.key}`}
            className={`tab${t.key === tab ? ' active' : ''}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'freigaben' ? (
        <section className="card card--table">
          <h2 style={{ padding: '0.8rem 1.25rem 0' }}>Freigabe-Regeln pro Skill</h2>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            <span className="chip chip--amber">Failsafe</span> Freigabe kann bei geldbewegenden
            Skills nicht abgeschaltet werden — Modus „nie" wird von der Engine zur Laufzeit
            überstimmt und auditiert.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Aktuelle Regel</th>
                <th>Modus</th>
                <th>Schwelle (EUR)</th>
                <th>Freigeber-Rolle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => {
                const policy = policies.find((p) => p.skillKey === skill.key) ?? null;
                return (
                  <tr key={skill.key}>
                    <td>
                      <strong>{skill.title}</strong>
                      <div className="row-meta mono">{skill.key}</div>
                      {skill.handlesMoney ? (
                        <span className="chip chip--orange" title="Freigabe kann bei geldbewegenden Skills nicht abgeschaltet werden">
                          bewegt Geld
                        </span>
                      ) : null}
                    </td>
                    <td className="row-meta">
                      {policy
                        ? policy.mode === 'threshold' && policy.thresholdAmount
                          ? `ab ${formatEuro(policy.thresholdAmount.toNumber())}`
                          : policy.mode === 'always'
                            ? 'immer'
                            : skill.handlesMoney
                              ? 'nie (Failsafe greift)'
                              : 'nie'
                        : 'keine Policy — Skill-Guardrail gilt'}
                    </td>
                    <FormCells
                      skillKey={skill.key}
                      defaultMode={policy?.mode ?? 'always'}
                      defaultThreshold={policy?.thresholdAmount?.toNumber() ?? null}
                      defaultApprover={policy?.approverRole ?? 'lead'}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'sichtbarkeit' ? (
        <>
          <section className="card">
            <h2>Die drei Sichtbarkeits-Stufen</h2>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem' }}>
              {LEVEL_EXPLANATION.map(({ level, text }) => (
                <li key={level}>
                  <VisibilityBadge visibility={level} /> <span className="row-meta">{text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Wer darf welche Stufe sehen?</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              „open" braucht keinen Grant. Kein Haken = Rolle sieht die Stufe nicht (fail-closed).
            </p>
            <form action={saveVisibilityGrants}>
              <table className="table" style={{ maxWidth: '32rem' }}>
                <thead>
                  <tr>
                    <th>Stufe</th>
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
                            aria-label={`${level} für ${ROLE_LABEL[r]}`}
                            defaultChecked={granted.has(`${level}:${r}`)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="submit" className="btn btn--primary" style={{ marginTop: '0.6rem' }}>
                Grants speichern
              </button>
            </form>
          </section>

          <section className="card card--table">
            <h2 style={{ padding: '0.8rem 1.25rem 0' }}>Dokumente &amp; ihre Stufe</h2>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              Die Stufe eines Dokuments änderst du in der{' '}
              <Link href="/dashboard/knowledge">Wissensbasis</Link>.
            </p>
            {documents.length === 0 ? (
              <p className="muted" style={{ padding: '0 1.25rem 0.8rem' }}>Noch keine Dokumente.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Titel</th>
                    <th>Sichtbarkeit</th>
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

      {tab === 'mitglieder' ? (
        <section className="card card--table">
          <h2 style={{ padding: '0.8rem 1.25rem 0' }}>Mitglieder ({memberships.length})</h2>
          <p className="muted" style={{ padding: '0 1.25rem' }}>
            Mindestens ein Admin bleibt immer bestehen — die letzte Admin-Rolle lässt sich nicht
            entziehen. Jede Änderung wird auditiert.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Kennung</th>
                <th>Rolle</th>
                <th>Rolle ändern</th>
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
                      {lastAdmin ? <span className="chip chip--amber">letzter Admin</span> : null}
                    </td>
                    <td>
                      {m.role === 'owner' ? (
                        <span className="row-meta">Owner wird nur manuell vergeben</span>
                      ) : (
                        <form action={saveMembershipRole} style={{ display: 'inline-block' }}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <select name="role" defaultValue={m.role} className="select--inline">
                            <option value="member">member</option>
                            <option value="lead">lead</option>
                            <option value="admin">admin</option>
                          </select>{' '}
                          <button type="submit" className="btn btn--ghost select--inline">
                            Ändern
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

      {tab === 'slack' ? (
        <>
          <section className="card">
            <h2>Slack-Verbindung</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Ein Slack-Workspace (Team) wird auf genau <strong>eine</strong> Organisation gemappt.
              Anfragen aus nicht gemappten Workspaces werden abgewiesen. MVP: die Team-ID wird
              manuell eingetragen — ein OAuth-Install-Flow ist ein späterer Schritt. Der Bot-Token
              bleibt in <code>.env</code> (<code>SLACK_BOT_TOKEN</code>); die Datenbank speichert
              nur einen Verweis, nie das Secret.
            </p>
            {slackInstallations.length > 0 ? (
              <p>
                <span className="chip chip--indigo">verbunden</span>{' '}
                Team{' '}
                {slackInstallations.map((i) => (
                  <code key={i.id} className="mono" style={{ marginRight: '0.4rem' }}>
                    {i.slackTeamId}
                  </code>
                ))}
              </p>
            ) : (
              <form action={saveSlackInstallation}>
                <p>
                  <span className="chip chip--gray">nicht verbunden</span>
                </p>
                <input
                  name="slackTeamId"
                  placeholder="Slack-Team-ID, z. B. T0123456789"
                  className="select--inline"
                  style={{ width: '16rem' }}
                  required
                />{' '}
                <button type="submit" className="btn btn--primary select--inline">
                  Workspace verbinden
                </button>
              </form>
            )}
          </section>

          <section className="card card--table">
            <h2 style={{ padding: '0.8rem 1.25rem 0' }}>
              Slack-Nutzer ↔ Mitglieder ({slackLinks.length})
            </h2>
            <p className="muted" style={{ padding: '0 1.25rem' }}>
              Nur verknüpfte Slack-Nutzer handeln mit ihrer Mitglieds-Rolle (Skills starten,
              Freigaben erteilen). Unverknüpfte Nutzer sehen ausschließlich „open"-Wissen und
              können nichts auslösen (fail-closed).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Slack-User-ID</th>
                  <th>Mitglied</th>
                  <th>Rolle</th>
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
                            Entknüpfen
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
                      placeholder="z. B. U0123456789"
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
                      Verknüpfen
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
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
}: {
  skillKey: string;
  defaultMode: string;
  defaultThreshold: number | null;
  defaultApprover: string;
}) {
  const formId = `policy-${skillKey}`;
  return (
    <>
      <td>
        <form id={formId} action={saveApprovalPolicy}>
          <input type="hidden" name="skillKey" value={skillKey} />
        </form>
        <select name="mode" defaultValue={defaultMode} className="select--inline" form={formId}>
          <option value="always">immer</option>
          <option value="threshold">ab Schwelle</option>
          <option value="never">nie</option>
        </select>
      </td>
      <td>
        <input
          name="thresholdAmount"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={defaultThreshold ?? undefined}
          placeholder="z. B. 5000"
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
          Speichern
        </button>
      </td>
    </>
  );
}
