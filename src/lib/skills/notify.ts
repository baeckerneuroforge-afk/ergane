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
//   - Sprache: Org-Locale (org_settings.locale, Default 'en') — die Mail geht
//     an einen org-weiten Alias, nicht an einen Browser.
import { getEmailProvider } from '../effects';
import { getDictionary, isLocale, type Locale } from '../i18n';
import { logError } from '../log';
import { withTenant } from '../tenant';

export interface ApprovalNotification {
  orgId: string;
  runId: string;
  skillKey: string;
  skillTitle: string;
  reason: string;
}

const MAIL_TEXTS: Record<Locale, {
  subject: (skillTitle: string) => string;
  intro: string;
  skill: string;
  reason: string;
  run: string;
  decide: string;
}> = {
  en: {
    subject: (skillTitle) => `Approval requested: ${skillTitle}`,
    intro: 'A skill run is waiting for human approval.',
    skill: 'Skill',
    reason: 'Reason',
    run: 'Run',
    decide: 'To decide: Dashboard → Approvals (/dashboard/approvals)',
  },
  de: {
    subject: (skillTitle) => `Freigabe angefragt: ${skillTitle}`,
    intro: 'Ein Skill-Lauf wartet auf menschliche Freigabe.',
    skill: 'Skill',
    reason: 'Grund',
    run: 'Run',
    decide: 'Zur Entscheidung: Dashboard → Freigaben (/dashboard/approvals)',
  },
};

/** true = Mail wurde übergeben; false = keine Adresse/Fehler (geloggt). */
export async function notifyApprovalRequested(n: ApprovalNotification): Promise<boolean> {
  try {
    const settings = await withTenant(n.orgId, (tx) =>
      tx.orgSettings.findUnique({ where: { orgId: n.orgId } }),
    );
    const to = settings?.approvalNotifyEmail;
    if (!to) return false;

    const rawLocale = settings?.locale;
    const locale: Locale = isLocale(rawLocale) ? rawLocale : 'en';
    const texts = MAIL_TEXTS[locale];
    const title = getDictionary(locale).skillTitles[n.skillKey] ?? n.skillTitle;

    await getEmailProvider().send({
      to,
      subject: texts.subject(title),
      text: [
        texts.intro,
        '',
        `${texts.skill}: ${title} (${n.skillKey})`,
        `${texts.reason}: ${n.reason}`,
        `${texts.run}: ${n.runId}`,
        '',
        texts.decide,
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
