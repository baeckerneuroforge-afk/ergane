import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { listSkills } from '@/lib/skills';
import { withTenant } from '@/lib/tenant';
import { OnboardingCard } from './onboarding';
import { ActorChip, formatDateTime } from './ui';

export const dynamic = 'force-dynamic';

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  knowledge: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  skills: 'M13 2 3 14h7l-1 8 10-12h-7l1-8z',
  runs: 'M12 22a10 10 0 1 0-10-10M2 22l5-5M2 17v5h5',
  approvals: 'M9 12l2 2 4-4M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z',
  chat: 'M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

export default async function DashboardPage() {
  const { orgId } = await requireTenant();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { documentCount, runsLast7d, pendingApprovals, recentAudit, onboarding } =
    await withTenant(orgId, async (tx) => {
      const documents = await tx.document.count();
      return {
        documentCount: documents,
        runsLast7d: await tx.skillRun.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        pendingApprovals: await tx.approval.count({ where: { status: 'pending' } }),
        recentAudit: await tx.auditLog.findMany({
          // The overview row shows time/action/actor only — skip `detail` (JSON).
          select: { id: true, createdAt: true, action: true, actorType: true },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
        // "Erste Schritte": Fortschritt aus echten Daten, kein eigener Zustand.
        onboarding: {
          hasDocument: documents > 0,
          hasChatMessage: (await tx.chatMessage.count()) > 0,
          hasRun: (await tx.skillRun.count()) > 0,
          hasCompanyProfile: Boolean(
            (await tx.orgSettings.findUnique({ where: { orgId } }))?.companyName,
          ),
        },
      };
    });
  const skillCount = listSkills().length;

  const kpis = [
    {
      label: 'Wissens-Einträge',
      value: documentCount,
      href: '/dashboard/knowledge',
      icon: ICONS.knowledge,
      attention: false,
    },
    {
      label: 'Skills verfügbar',
      value: skillCount,
      href: '/dashboard/skills',
      icon: ICONS.skills,
      attention: false,
    },
    {
      label: 'Ausführungen (7 Tage)',
      value: runsLast7d,
      href: '/dashboard/runs',
      icon: ICONS.runs,
      attention: false,
    },
    {
      label: 'Wartende Freigaben',
      value: pendingApprovals,
      href: '/dashboard/approvals',
      icon: ICONS.approvals,
      attention: pendingApprovals > 0,
    },
  ];

  return (
    <>
      <OnboardingCard progress={onboarding} />

      {pendingApprovals > 0 ? (
        <div className="banner" role="status">
          <Icon d={ICONS.approvals} />
          <span>
            <strong>
              {pendingApprovals} {pendingApprovals === 1 ? 'Ausführung wartet' : 'Ausführungen warten'}
            </strong>{' '}
            auf eine menschliche Freigabe.
          </span>
          <Link href="/dashboard/approvals">Jetzt entscheiden →</Link>
        </div>
      ) : null}

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <Link className="card kpi-card" key={kpi.label} href={kpi.href}>
            <div className="kpi-body">
              <div className="kpi-label">{kpi.label}</div>
              <div className={`kpi-value${kpi.attention ? ' attention' : ''}`}>{kpi.value}</div>
            </div>
            <span className={`kpi-icon${kpi.attention ? ' kpi-icon--attention' : ''}`}>
              <Icon d={kpi.icon} />
            </span>
          </Link>
        ))}
      </div>

      <section className="card card--table">
        <div className="card-title">
          <h2>Letzte Aktivität</h2>
          <Link className="row-meta" href="/dashboard/audit">
            Vollständiges Audit →
          </Link>
        </div>
        {recentAudit.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>
            Noch keine Einträge. Aktivität erscheint hier, sobald Wissen ingestiert oder ein
            Skill ausgeführt wird.
          </p>
        ) : (
          <table className="table">
            <tbody>
              {recentAudit.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="mono">{entry.action}</td>
                  <td>
                    <ActorChip actorType={entry.actorType} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="quick-grid">
        <Link className="card quick-card" href="/dashboard/chat">
          <span className="quick-icon">
            <Icon d={ICONS.chat} />
          </span>
          <strong>Frage stellen</strong>
          <span className="quick-hint">Antworten aus dem geprüften Wissen — immer mit Quellen.</span>
          <span className="quick-arrow">
            <Icon d={ICONS.arrow} />
          </span>
        </Link>
        <Link className="card quick-card" href="/dashboard/knowledge">
          <span className="quick-icon">
            <Icon d={ICONS.knowledge} />
          </span>
          <strong>Wissen hochladen</strong>
          <span className="quick-hint">PDF, DOCX, Markdown oder Text ingestieren und Sichtbarkeit steuern.</span>
          <span className="quick-arrow">
            <Icon d={ICONS.arrow} />
          </span>
        </Link>
        <Link className="card quick-card" href="/dashboard/skills">
          <span className="quick-icon">
            <Icon d={ICONS.skills} />
          </span>
          <strong>Skill starten</strong>
          <span className="quick-hint">Automatisierungen ausführen — Guardrails inklusive.</span>
          <span className="quick-arrow">
            <Icon d={ICONS.arrow} />
          </span>
        </Link>
      </div>
    </>
  );
}
