'use client';

import { approveRun, rejectRun } from './actions';

/**
 * Freigeben/Ablehnen with a native confirmation dialog. The buttons are only
 * a convenience gate — the real role check lives in the engine's decide().
 */
export function ApprovalActions({
  runId,
  canDecide,
  requiredRole,
}: {
  runId: string;
  canDecide: boolean;
  requiredRole: string | null;
}) {
  const tooltip = !canDecide && requiredRole ? `Benötigt Rolle: ${requiredRole}` : undefined;

  return (
    <div className="approval-actions">
      <form
        action={approveRun}
        onSubmit={(e) => {
          if (!window.confirm('Diese Ausführung wirklich freigeben?')) e.preventDefault();
        }}
      >
        <input type="hidden" name="runId" value={runId} />
        <span title={tooltip}>
          <button type="submit" className="btn btn--primary" disabled={!canDecide}>
            Freigeben
          </button>
        </span>
      </form>
      <form
        action={rejectRun}
        onSubmit={(e) => {
          if (!window.confirm('Diese Ausführung wirklich ablehnen?')) e.preventDefault();
        }}
      >
        <input type="hidden" name="runId" value={runId} />
        <span title={tooltip}>
          <button type="submit" className="btn btn--ghost" disabled={!canDecide}>
            Ablehnen
          </button>
        </span>
      </form>
    </div>
  );
}
