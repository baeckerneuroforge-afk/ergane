import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { isDemoOrg } from '@/lib/demo/isolation';
import { getI18n } from '@/lib/i18n/server';
import { toFlagView } from '@/lib/loop/flags-view';
import { computeLoopKpis, formatApprovalLatencyMs } from '@/lib/loop/kpis';
import { formatMoney } from '@/lib/money';
import { withTenant } from '@/lib/tenant';
import { computeValueStats } from '@/lib/value';
import { DemoGuidanceCard } from './demo-guidance';
import { CategoryChip, DeviationSummary, SeverityChip } from './flags/flag-cells';
import { OnboardingCard } from './onboarding';
import { ActorChip, RunStatusChip, formatDateTime } from './ui';

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

export default async function CockpitPage() {
  const { orgId, clerkOrgId, orgSlug } = await requireTenant();
  const { locale, t } = await getI18n();
  const c = t.cockpit;
  const o = t.overview;
  const showDemoGuidance = isDemoOrg({ clerkOrgId, orgSlug });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const data = await withTenant(orgId, async (tx) => {
    // Loop KPIs are sequential (pinned tx); other reads can still batch after.
    const loopKpis = await computeLoopKpis(tx, orgId, { since: sevenDaysAgo });

    const [
      pendingApprovals,
      pendingApprovalsList,
      clients,
      valueStats,
      artifactCount30d,
      recentAudit,
      flagCount7d,
      lastFlag,
      onboarding,
    ] = await Promise.all([
      tx.approval.count({ where: { status: 'pending' } }),
      tx.approval.findMany({
        where: { status: 'pending' },
        select: {
          id: true,
          createdAt: true,
          run: { select: { id: true, skillKey: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 5,
      }),
      tx.client.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { artifacts: true } },
          skillRuns: {
            select: { id: true, skillKey: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
      computeValueStats(tx, orgId, { since: thirtyDaysAgo }),
      tx.artifact.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      tx.auditLog.findMany({
        select: { id: true, createdAt: true, action: true, actorType: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      // Deviation raises only (same as computeLoopKpis): never count
      // flag.status_changed from ack/resolve — that inflated the 7d total.
      tx.auditLog.count({
        where: {
          action: { in: ['flag.criteria_violated', 'flag.metric_deviation'] },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      tx.auditLog.findFirst({
        where: {
          action: { in: ['flag.criteria_violated', 'flag.metric_deviation'] },
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
      }),
      {
        hasDocument: (await tx.document.count()) > 0,
        hasChatMessage: (await tx.chatMessage.count()) > 0,
        hasRun: (await tx.skillRun.count()) > 0,
        hasCompanyProfile: Boolean(
          (await tx.orgSettings.findUnique({ where: { orgId } }))?.companyName,
        ),
      },
    ]);

    return {
      pendingApprovals,
      pendingApprovalsList,
      clients,
      valueStats,
      artifactCount30d,
      recentAudit,
      flagCount7d,
      lastFlag,
      onboarding,
      loopKpis,
    };
  });

  const lastFlagView = data.lastFlag ? toFlagView(data.lastFlag) : null;

  const activeClients = data.clients.filter(
    (cl) => cl.skillRuns.length > 0 || cl._count.artifacts > 0,
  );

  const kpis = [
    {
      label: c.activeClients,
      value: activeClients.length,
      href: '/dashboard/clients',
      attention: false,
    },
    {
      label: c.deliverables30d,
      value: data.artifactCount30d,
      href: '/dashboard/deliverables',
      attention: false,
    },
    {
      label: o.kpiPendingApprovals,
      value: data.pendingApprovals,
      href: '/dashboard/approvals',
      attention: data.pendingApprovals > 0,
    },
    {
      label: c.value30d,
      value: formatMoney(data.valueStats.savedUsd),
      href: '/dashboard/value',
      attention: false,
    },
  ];

  return (
    <>
      {showDemoGuidance ? (
        <DemoGuidanceCard dict={t.demoGuidance} includeIsolation />
      ) : null}
      <OnboardingCard progress={data.onboarding} dict={t.onboarding} />

      {data.pendingApprovals > 0 ? (
        <div className="banner" role="status">
          <Icon d="M9 12l2 2 4-4M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />
          <span>
            <strong>{o.bannerWaiting(data.pendingApprovals)}</strong> {o.bannerSuffix}
          </span>
          <Link href="/dashboard/approvals">{o.bannerCta}</Link>
        </div>
      ) : null}

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <Link className="card kpi-card" key={kpi.label} href={kpi.href}>
            <div className="kpi-body">
              <div className="kpi-label">{kpi.label}</div>
              <div className={`kpi-value${kpi.attention ? ' attention' : ''}`}>{kpi.value}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* --- Recent by client --- */}
      <section className="card card--table">
        <div className="card-title">
          <h2>{c.clientsTitle}</h2>
          {data.clients.length > 0 ? (
            <Link className="row-meta" href="/dashboard/clients">
              {c.allClients}
            </Link>
          ) : null}
        </div>
        {data.clients.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>
            {c.noClients}{' '}
            <Link href="/dashboard/settings?tab=clients">{c.noClientsLink}</Link>{' '}
            {c.noClientsOrActivity}
          </p>
        ) : (
          <table className="table">
            <tbody>
              {data.clients.map((cl) => {
                const lastRun = cl.skillRuns[0];
                return (
                  <tr key={cl.id}>
                    <td>
                      <Link href={`/dashboard/clients/${cl.id}`}>
                        <strong>{cl.name}</strong>
                      </Link>
                    </td>
                    <td>
                      {lastRun ? (
                        <span>
                          <span className="mono row-meta">{c.lastRun}: </span>
                          <RunStatusChip status={lastRun.status} locale={locale} />
                          <span className="mono row-meta" style={{ marginLeft: '0.4rem' }}>
                            {formatDateTime(lastRun.createdAt, locale)}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">{c.noRuns}</span>
                      )}
                    </td>
                    <td>
                      {cl._count.artifacts > 0 ? (
                        <span className="chip chip--indigo">
                          {c.openDeliverables(cl._count.artifacts)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Waiting for you --- */}
      <section className="card card--table">
        <div className="card-title">
          <h2>{c.waitingTitle}</h2>
        </div>
        {data.pendingApprovalsList.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>{c.noWaiting}</p>
        ) : (
          <table className="table">
            <tbody>
              {data.pendingApprovalsList.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="chip chip--amber">{a.run.skillKey}</span>
                  </td>
                  <td className="mono row-meta">
                    {c.waitingSince} {formatDateTime(a.createdAt, locale)}
                  </td>
                  <td>
                    <Link href={`/dashboard/runs/${a.run.id}`}>{c.decideNow}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Loop KPIs + latest flag --- */}
      <section className="card">
        <div className="card-title">
          <h2>{c.loopKpisTitle}</h2>
          <Link className="row-meta" href="/dashboard/flags">
            {c.flagsAll}
          </Link>
        </div>
        <div
          className="kpi-grid"
          style={{ margin: '0 0 0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))' }}
        >
          <div>
            <div className="kpi-label">{c.loopKpiFlags}</div>
            <div className="kpi-value" style={{ fontSize: '1.35rem' }}>
              {data.loopKpis.flags}
            </div>
          </div>
          <div>
            <div className="kpi-label">{c.loopKpiCorrections}</div>
            <div className="kpi-value" style={{ fontSize: '1.35rem' }}>
              {data.loopKpis.corrections}
            </div>
          </div>
          <div>
            <div className="kpi-label">{c.loopKpiLatency}</div>
            <div className="kpi-value" style={{ fontSize: '1.35rem' }}>
              {formatApprovalLatencyMs(data.loopKpis.approvalLatencyMedianMs, locale)}
            </div>
          </div>
          <div>
            <div className="kpi-label">{c.loopKpiProcess}</div>
            <div className="kpi-value" style={{ fontSize: '1.35rem' }}>
              {c.loopKpiProcessOf(
                data.loopKpis.processMetricsHealthy,
                data.loopKpis.processMetricsTotal,
              )}
            </div>
          </div>
        </div>
        {lastFlagView ? (
          <>
            <div className="row-meta" style={{ marginBottom: '0.35rem' }}>
              {c.flagsLast} · {formatDateTime(lastFlagView.createdAt, locale)} ·{' '}
              <strong>{c.flagsCount(data.flagCount7d)}</strong> {c.flagsWindow}
            </div>
            <div className="flag-line">
              <SeverityChip view={lastFlagView} locale={locale} />
              <CategoryChip view={lastFlagView} locale={locale} />
              <DeviationSummary view={lastFlagView} locale={locale} max={1} />
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {c.noFlags}
          </p>
        )}
      </section>

      {/* --- Recent activity --- */}
      <section className="card card--table">
        <div className="card-title">
          <h2>{o.recentActivity}</h2>
          <Link className="row-meta" href="/dashboard/audit">
            {o.fullAudit}
          </Link>
        </div>
        {data.recentAudit.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.3rem 0.8rem' }}>
            {o.noActivity}
          </p>
        ) : (
          <table className="table">
            <tbody>
              {data.recentAudit.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(entry.createdAt, locale)}
                  </td>
                  <td className="mono">{entry.action}</td>
                  <td>
                    <ActorChip actorType={entry.actorType} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
