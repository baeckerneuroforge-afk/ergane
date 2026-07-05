// Value dashboard ("Automation Score") — the CFO answer in numbers.
//
// Pure aggregation over skill_runs inside withTenant (RLS): live runs, success
// rate, saved hours and their USD equivalent (src/lib/money.ts is the single
// currency authority). Simulations (mode='simulation') NEVER appear here — the
// filter lives in computeValueStats and is pinned by tests/value-dashboard.test.ts.
import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { withTenant } from '@/lib/tenant';
import { computeValueStats } from '@/lib/value';
import { ValueChart } from './value-chart';

export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90, 365] as const;
const DEFAULT_PERIOD = 30;

export default async function ValuePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const v = t.value;

  const params = await searchParams;
  const parsed = Number.parseInt(params.days ?? '', 10);
  const days = PERIODS.find((p) => p === parsed) ?? DEFAULT_PERIOD;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const stats = await withTenant(orgId, (tx) => computeValueStats(tx, orgId, { since }));
  const decided = stats.completedRuns + stats.rejectedOrFailedRuns;

  const monthLabel = (key: string) => {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)).toLocaleDateString(
      locale === 'de' ? 'de-DE' : 'en-US',
      { month: 'short', year: 'numeric', timeZone: 'UTC' },
    );
  };

  const kpis = [
    { label: v.kpiRuns, value: String(stats.totalRuns) },
    {
      label: v.kpiSuccessRate,
      value: stats.successRate === null ? t.common.none : `${Math.round(stats.successRate * 100)}%`,
    },
    { label: v.kpiSavedHours, value: v.hours(stats.savedHours) },
    { label: v.kpiSavedValue, value: formatMoney(stats.savedUsd) },
  ];

  return (
    <>
      <p className="page-intro">
        {v.intro} <Link href="/dashboard/settings?tab=value">{v.introSettingsLink}</Link>.
      </p>

      <nav className="tabs" aria-label={v.periodAria}>
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/dashboard/value?days=${p}`}
            className={`tab${p === days ? ' active' : ''}`}
          >
            {v.periodDays(p)}
          </Link>
        ))}
      </nav>

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div className="card kpi-card" key={kpi.label}>
            <div className="kpi-body">
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="muted">
        {decided > 0 ? v.successRateHint(stats.completedRuns, decided) : v.noDecidedRuns}
        {' · '}
        {v.assumptions(formatMoney(stats.settings.hourlyRateUsd))}
      </p>

      <ValueChart
        months={stats.months}
        locale={locale}
        chartTitle={v.chartTitle}
        barLabel={v.chartBarLabel}
        lineLabel={v.chartLineLabel}
      />

      <section className="card card--table">
        <div className="card-title">
          <h2>{v.perSkillTitle}</h2>
        </div>
        <p className="muted" style={{ padding: '0 1.25rem' }}>
          {v.perSkillHint}
        </p>
        {stats.perSkill.length === 0 ? (
          <p className="muted" style={{ padding: '0 1.25rem 0.8rem' }}>
            {v.noRuns}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.skill}</th>
                <th>{v.colRuns}</th>
                <th>{v.colCompleted}</th>
                <th>{v.colSavedHours}</th>
                <th>{v.colSavedValue}</th>
              </tr>
            </thead>
            <tbody>
              {stats.perSkill.map((row) => (
                <tr key={row.skillKey}>
                  <td>
                    <strong>{t.skillTitles[row.skillKey] ?? row.skillKey}</strong>
                    <div className="row-meta mono">{row.skillKey}</div>
                  </td>
                  <td className="mono">{row.runs}</td>
                  <td className="mono">{row.completed}</td>
                  <td className="mono">{v.hours(row.savedHours)}</td>
                  <td className="mono">{formatMoney(row.savedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {stats.months.length > 0 ? (
        <section className="card card--table">
          <div className="card-title">
            <h2>{v.monthlyTitle}</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>{v.colMonth}</th>
                <th>{v.colRuns}</th>
                <th>{v.colCompleted}</th>
                <th>{v.colSavedHours}</th>
                <th>{v.colSavedValue}</th>
              </tr>
            </thead>
            <tbody>
              {stats.months.map((row) => (
                <tr key={row.month}>
                  <td>{monthLabel(row.month)}</td>
                  <td className="mono">{row.runs}</td>
                  <td className="mono">{row.completed}</td>
                  <td className="mono">{v.hours(row.savedHours)}</td>
                  <td className="mono">{formatMoney(row.savedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
