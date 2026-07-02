import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { listSkills } from '@/lib/skills';
import { withTenant } from '@/lib/tenant';
import { ActorChip, formatDateTime } from './ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { orgId } = await requireTenant();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { documentCount, runsLast7d, pendingApprovals, recentAudit } = await withTenant(
    orgId,
    async (tx) => ({
      documentCount: await tx.document.count(),
      runsLast7d: await tx.skillRun.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      pendingApprovals: await tx.approval.count({ where: { status: 'pending' } }),
      recentAudit: await tx.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    }),
  );
  const skillCount = listSkills().length;

  const kpis = [
    { label: 'Wissens-Einträge', value: documentCount, attention: false },
    { label: 'Skills verfügbar', value: skillCount, attention: false },
    { label: 'Ausführungen (7 Tage)', value: runsLast7d, attention: false },
    { label: 'Wartende Freigaben', value: pendingApprovals, attention: pendingApprovals > 0 },
  ];

  return (
    <>
      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div className="card" key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className={`kpi-value${kpi.attention ? ' attention' : ''}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <section className="card card--table">
        <h2 style={{ padding: '0.8rem 1.25rem 0' }}>Letzte Aktivität</h2>
        {recentAudit.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.25rem 0.8rem' }}>
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
        <Link className="card quick-card" href="/dashboard/skills">
          <strong>Skills</strong>
          <span className="quick-hint">Automatisierungen starten — Guardrails inklusive.</span>
        </Link>
        <Link className="card quick-card" href="/dashboard/knowledge">
          <strong>Wissensbasis</strong>
          <span className="quick-hint">Dokumente ingestieren und Sichtbarkeit steuern.</span>
        </Link>
        <Link className="card quick-card" href="/dashboard/chat">
          <strong>Chat</strong>
          <span className="quick-hint">Fragen ans geprüfte Wissen — Antworten mit Quellen.</span>
        </Link>
      </div>
    </>
  );
}
