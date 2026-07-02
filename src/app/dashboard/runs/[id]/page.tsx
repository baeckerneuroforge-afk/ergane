import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { getSkill } from '@/lib/skills';
import { withTenant } from '@/lib/tenant';
import { isUuid } from '@/lib/uuid';
import { JsonView, RunStatusChip, amountOfInput, formatDateTime, formatEuro } from '../../ui';

export const dynamic = 'force-dynamic';

function TimelineDot({ status }: { status: 'done' | 'failed' | 'pending' }) {
  if (status === 'done') {
    return (
      <span className="tl-dot tl-dot--done" aria-label="erledigt">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="tl-dot tl-dot--failed" aria-label="fehlgeschlagen">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return <span className="tl-dot" aria-label="ausstehend" />;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { orgId } = await requireTenant();

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

  return (
    <>
      <section className="card" style={{ display: 'grid', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            <span className="mono">{run.skillKey}</span>
          </h2>
          <RunStatusChip status={run.status} />
        </div>
        <div className="row-meta">
          <span className="mono">{run.id}</span> · gestartet {formatDateTime(run.createdAt)}
          {amount !== null ? (
            <>
              {' '}
              · <span className="mono">{formatEuro(amount)}</span>
            </>
          ) : null}
        </div>
      </section>

      {pendingApproval ? (
        <section className="card card--awaiting">
          <strong>Wartet auf Freigabe:</strong> {pendingApproval.reason}
          <div style={{ marginTop: '0.4rem' }}>
            <Link href="/dashboard/approvals">Zur Freigaben-Warteschlange →</Link>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Schritte</h2>
        <ol className="timeline">
          {declaredSteps.map((name, idx) => {
            const step = stepByIdx.get(idx);
            const status = step ? (step.status === 'done' ? 'done' : 'failed') : 'pending';
            return (
              <li key={`${idx}-${name}`}>
                <TimelineDot status={status} />
                <div className="tl-name">{name}</div>
                {step?.detail != null ? (
                  <details className="json-details">
                    <summary>Detail</summary>
                    <JsonView value={step.detail} />
                  </details>
                ) : (
                  <div className="row-meta">
                    {status === 'pending' ? 'noch nicht ausgeführt' : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {approvals.length > 0 ? (
        <section className="card">
          <h2>Freigaben</h2>
          {approvals.map((a) => (
            <div key={a.id} className="row-meta" style={{ marginBottom: '0.35rem' }}>
              <span className="mono">{a.status}</span> — {a.reason}
              {a.decidedBy ? (
                <>
                  {' '}
                  · entschieden von <span className="mono">{a.decidedBy}</span>
                  {a.decidedAt ? ` am ${formatDateTime(a.decidedAt)}` : null}
                </>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>Ergebnis</h2>
        {run.result != null ? (
          <JsonView value={run.result} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Noch kein Ergebnis — der Run ist nicht abgeschlossen.
          </p>
        )}
      </section>
    </>
  );
}
