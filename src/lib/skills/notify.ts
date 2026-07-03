// Freigabe-Benachrichtigung — best-effort, NIE Teil der Freigabe-Mechanik.
//
// Wenn ein Run in awaiting_approval pausiert, geht eine kurze Mail an die im
// Tenant hinterlegte Adresse (org_settings.approval_notify_email, z. B. ein
// Team-Alias). Bewusste Eigenschaften:
//   - läuft NACH dem Commit der Pause-Transaktion (kein Effekt vor Commit)
//   - wirft NIEMALS: jeder Fehler (kein Provider-Key in prod, Netzwerk, …)
//     wird geloggt und verschluckt — Guardrail/Approval funktionieren immer
//     auch ohne Benachrichtigung
//   - keine Adresse konfiguriert ⇒ stiller No-op
import { getEmailProvider } from '../effects';
import { logError } from '../log';
import { withTenant } from '../tenant';

export interface ApprovalNotification {
  orgId: string;
  runId: string;
  skillKey: string;
  skillTitle: string;
  reason: string;
}

/** true = Mail wurde übergeben; false = keine Adresse/Fehler (geloggt). */
export async function notifyApprovalRequested(n: ApprovalNotification): Promise<boolean> {
  try {
    const settings = await withTenant(n.orgId, (tx) =>
      tx.orgSettings.findUnique({ where: { orgId: n.orgId } }),
    );
    const to = settings?.approvalNotifyEmail;
    if (!to) return false;

    await getEmailProvider().send({
      to,
      subject: `Freigabe angefragt: ${n.skillTitle}`,
      text: [
        `Ein Skill-Lauf wartet auf menschliche Freigabe.`,
        '',
        `Skill: ${n.skillTitle} (${n.skillKey})`,
        `Grund: ${n.reason}`,
        `Run: ${n.runId}`,
        '',
        `Zur Entscheidung: Dashboard → Freigaben (/dashboard/approvals)`,
      ].join('\n'),
    });
    return true;
  } catch (err) {
    logError('approval notification failed (best-effort, run unaffected)', err, {
      orgId: n.orgId,
      runId: n.runId,
    });
    return false;
  }
}
