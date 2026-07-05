import type { MonthValueRow } from '@/lib/value';
import { formatMoney } from '@/lib/money';

const BAR_GAP = 8;
const MIN_BAR_W = 28;
const MAX_BAR_W = 56;
const CHART_H = 180;
const Y_AXIS_W = 54;
const PADDING_TOP = 8;
const LABEL_H = 28;

function abbreviateUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return formatMoney(n);
}

function yTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = Math.ceil(rough / mag) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.01; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

export function ValueChart({
  months,
  locale,
  chartTitle,
  barLabel,
  lineLabel,
}: {
  months: MonthValueRow[];
  locale: string;
  chartTitle: string;
  barLabel: string;
  lineLabel: string;
}) {
  if (months.length < 2) return null;

  const maxVal = Math.max(...months.map((m) => m.savedUsd));
  const maxRuns = Math.max(...months.map((m) => m.runs));
  const ticks = yTicks(maxVal);
  const tickMax = ticks[ticks.length - 1] ?? 1;

  const barCount = months.length;
  const barW = Math.max(MIN_BAR_W, Math.min(MAX_BAR_W, (600 - Y_AXIS_W) / barCount - BAR_GAP));
  const contentW = barCount * (barW + BAR_GAP) - BAR_GAP;
  const svgW = Y_AXIS_W + contentW + 16;
  const drawH = CHART_H - PADDING_TOP;

  const yOf = (v: number) => PADDING_TOP + drawH - (v / tickMax) * drawH;
  const barX = (i: number) => Y_AXIS_W + i * (barW + BAR_GAP);
  const barMidX = (i: number) => barX(i) + barW / 2;

  const fmtMonth = (key: string) => {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)).toLocaleDateString(
      locale === 'de' ? 'de-DE' : 'en-US',
      { month: 'short', timeZone: 'UTC' },
    );
  };

  const linePoints = months
    .map((m, i) => `${barMidX(i)},${maxRuns > 0 ? yOf((m.runs / maxRuns) * tickMax) : CHART_H}`)
    .join(' ');

  return (
    <section className="card value-chart" aria-label={chartTitle}>
      <div className="card-title">
        <h2>{chartTitle}</h2>
        <span className="value-chart-legend">
          <span className="value-chart-legend-bar" />
          {barLabel}
          <span className="value-chart-legend-line" />
          {lineLabel}
        </span>
      </div>

      <div className="value-chart-scroll">
        <svg
          className="value-chart-svg"
          viewBox={`0 0 ${svgW} ${CHART_H + LABEL_H}`}
          width={svgW}
          height={CHART_H + LABEL_H}
          role="img"
          aria-label={chartTitle}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={Y_AXIS_W - 4}
                x2={svgW}
                y1={yOf(v)}
                y2={yOf(v)}
                className="value-chart-grid"
              />
              <text x={Y_AXIS_W - 8} y={yOf(v) + 4} className="value-chart-axis" textAnchor="end">
                {abbreviateUsd(v)}
              </text>
            </g>
          ))}

          {months.map((m, i) => {
            const h = tickMax > 0 ? (m.savedUsd / tickMax) * drawH : 0;
            return (
              <g key={m.month}>
                <rect
                  x={barX(i)}
                  y={CHART_H - h}
                  width={barW}
                  height={Math.max(h, 0)}
                  className="value-chart-bar"
                  rx={3}
                >
                  <title>
                    {fmtMonth(m.month)}: {formatMoney(m.savedUsd)} · {m.runs} runs
                  </title>
                </rect>
                <text
                  x={barMidX(i)}
                  y={CHART_H + 16}
                  className="value-chart-month"
                  textAnchor="middle"
                >
                  {fmtMonth(m.month)}
                </text>
              </g>
            );
          })}

          {maxRuns > 0 && (
            <>
              <polyline points={linePoints} className="value-chart-line" />
              {months.map((m, i) => (
                <circle
                  key={m.month}
                  cx={barMidX(i)}
                  cy={yOf((m.runs / maxRuns) * tickMax)}
                  r={3.5}
                  className="value-chart-dot"
                >
                  <title>
                    {fmtMonth(m.month)}: {m.runs} runs
                  </title>
                </circle>
              ))}
            </>
          )}
        </svg>
      </div>
    </section>
  );
}
