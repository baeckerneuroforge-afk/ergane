import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { getSkill } from '@/lib/skills';
import { withTenant } from '@/lib/tenant';
import { isUuid } from '@/lib/uuid';
import {
  JsonView,
  RunStatusChip,
  SimulationBadge,
  amountOfInput,
  formatDateTime,
  formatEuro,
} from '../../ui';

export const dynamic = 'force-dynamic';

function TimelineDot({
  status,
  labels,
}: {
  status: 'done' | 'failed' | 'pending';
  labels: { done: string; failed: string; pending: string };
}) {
  if (status === 'done') {
    return (
      <span className="tl-dot tl-dot--done" aria-label={labels.done}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="tl-dot tl-dot--failed" aria-label={labels.failed}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return <span className="tl-dot" aria-label={labels.pending} />;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { orgId } = await requireTenant();
  const { locale, t } = await getI18n();
  const r = t.runDetail;
  const sim = r.simulation;

  const { run, steps, approvals } = await withTenant(orgId, async (tx) => ({
    // RLS scopes to the tenant — a foreign run id is simply "not found".
    run: await tx.skillRun.findUnique({ where: { id } }),
    steps: await tx.skillStep.findMany({ where: { runId: id }, orderBy: { idx: 'asc' } }),
    approvals: await tx.approval.findMany({ where: { runId: id }, orderBy: { createdAt: 'asc' } }),
  }));
  if (!run) notFound();

  // Merge the declared steps of the skill with what actually ran.
  let declaredSteps: string[] = [];
  try {
    declaredSteps = getSkill(run.skillKey).steps.map((s) => s.name);
  } catch {
    declaredSteps = steps.map((s) => s.name);
  }
  const stepByIdx = new Map(steps.map((s) => [s.idx, s]));

  const pendingApproval = approvals.find((a) => a.status === 'pending');
  const amount = amountOfInput(run.input);
  const dotLabels = { done: r.stepDone, failed: r.stepFailed, pending: r.stepPending };

  return (
    <>
      <section className="card" style={{ display: 'grid', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            <span className="mono">{run.skillKey}</span>
          </h2>
          <RunStatusChip status={run.status} locale={locale} />
          {run.mode === 'simulation' ? <SimulationBadge locale={locale} /> : null}
        </div>
        <div className="row-meta">
          <span className="mono">{run.id}</span> · {r.started} {formatDateTime(run.createdAt, locale)}
          {amount !== null ? (
            <>
              {' '}
              · <span className="mono">{formatEuro(amount, locale)}</span>
            </>
          ) : null}
        </div>
      </section>

      {run.mode === 'simulation' ? (
        <section className="card card--sim">
          <strong>{sim.bannerTitle}</strong>
          <div style={{ marginTop: '0.3rem' }}>{sim.bannerBody}</div>
        </section>
      ) : null}

      {pendingApproval ? (
        <section className="card card--awaiting">
          <strong>{r.awaitingApproval}</strong> {pendingApproval.reason}
          <div style={{ marginTop: '0.4rem' }}>
            <Link href="/dashboard/approvals">{r.toApprovalQueue}</Link>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>{r.steps}</h2>
        <ol className="timeline">
          {declaredSteps.map((name, idx) => {
            const step = stepByIdx.get(idx);
            const status = step ? (step.status === 'done' ? 'done' : 'failed') : 'pending';
            // Dry-run: an acting step recorded as simulated (never executed).
            const detail = (step?.detail ?? null) as Record<string, unknown> | null;
            const simulated = !!detail && detail.simulated === true;
            return (
              <li key={`${idx}-${name}`}>
                <TimelineDot status={status} labels={dotLabels} />
                <div className="tl-name">{name}</div>
                {simulated ? (
                  <div className="row-meta" style={{ marginTop: '0.15rem' }}>
                    <span className="chip chip--sim">{sim.stepBadge}</span>{' '}
                    {detail.wouldRequireApproval ? (
                      <>
                        <strong>{sim.wouldRequireApproval}</strong> {String(detail.gateReason ?? '')}
                      </>
                    ) : (
                      sim.wouldExecuteNote
                    )}
                  </div>
                ) : null}
                {step?.detail != null ? (
                  <details className="json-details">
                    <summary>{t.common.detail}</summary>
                    <JsonView value={step.detail} />
                  </details>
                ) : (
                  <div className="row-meta">
                    {status === 'pending' ? r.notExecutedYet : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {approvals.length > 0 ? (
        <section className="card">
          <h2>{r.approvals}</h2>
          {approvals.map((a) => (
            <div key={a.id} className="row-meta" style={{ marginBottom: '0.35rem' }}>
              <span className="mono">{a.status}</span> — {a.reason}
              {a.decidedBy ? (
                <>
                  {' '}
                  · {r.decidedBy} <span className="mono">{a.decidedBy}</span>
                  {a.decidedAt ? ` ${r.decidedAt} ${formatDateTime(a.decidedAt, locale)}` : null}
                </>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>{r.result}</h2>
        {run.result != null ? (
          <JsonView value={run.result} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {r.noResult}
          </p>
        )}
      </section>
    </>
  );
}
