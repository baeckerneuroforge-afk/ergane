'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { listSkills, startRun, type SkillJson } from '@/lib/skills';
import { isUuid } from '@/lib/uuid';

/**
 * Start a skill run for the caller's tenant via the EXISTING engine
 * (startRun handles guardrail, approval, steps and audit) and jump to the
 * run's detail page.
 *
 * Trust boundary: orgId comes ONLY from requireTenant(); the skillKey is
 * validated against the catalog; the form supplies input fields only.
 */
export async function startSkillRun(formData: FormData) {
  const skillKey = String(formData.get('skillKey') ?? '');
  const skill = listSkills().find((s) => s.key === skillKey);
  if (!skill) throw new Error(`Unknown skill: ${JSON.stringify(skillKey)}`);

  let input: SkillJson;
  if (skill.key === 'beleg_kontieren') {
    const beschreibung = String(formData.get('beschreibung') ?? '').trim();
    const betragEur = Number.parseFloat(
      String(formData.get('betragEur') ?? '').replace(',', '.'),
    );
    const belegNummer = String(formData.get('belegNummer') ?? '').trim();
    if (!beschreibung) throw new Error('Description is required.');
    if (!Number.isFinite(betragEur) || betragEur <= 0) {
      throw new Error('Amount (EUR) must be a positive number.');
    }
    input = { beschreibung, betragEur, ...(belegNummer ? { belegNummer } : {}) };
  } else if (skill.key === 'wissen_zusammenfassen') {
    const frage = String(formData.get('frage') ?? '').trim();
    if (!frage) throw new Error('Question/topic is required.');
    input = { frage };
  } else if (skill.key === 'angebot_erstellen') {
    const kunde = String(formData.get('kunde') ?? '').trim();
    const leistung = String(formData.get('leistung') ?? '').trim();
    const betragEur = Number.parseFloat(
      String(formData.get('betragEur') ?? '').replace(',', '.'),
    );
    if (!kunde) throw new Error('Customer is required.');
    if (!leistung) throw new Error('Service is required.');
    if (!Number.isFinite(betragEur) || betragEur <= 0) {
      throw new Error('Amount (EUR) must be a positive number.');
    }
    const email = String(formData.get('email') ?? '').trim();
    input = { kunde, leistung, betragEur, ...(email ? { email } : {}) };
  } else if (skill.key === 'rechnung_erstellen') {
    const kunde = String(formData.get('kunde') ?? '').trim();
    if (!kunde) throw new Error('Customer is required.');
    // Eine Position pro Zeile: "Bezeichnung; Betrag" (Komma oder Punkt).
    const zeilen = String(formData.get('positionen') ?? '')
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean);
    if (zeilen.length === 0) throw new Error('At least one line item is required.');
    const positionen = zeilen.map((zeile, i) => {
      const [bezeichnung, betragRaw] = zeile.split(';').map((s) => s.trim());
      const betragEur = Number.parseFloat(String(betragRaw ?? '').replace(',', '.'));
      if (!bezeichnung || !Number.isFinite(betragEur) || betragEur <= 0) {
        throw new Error(`Line item ${i + 1}: expected "description; amount" with a positive amount.`);
      }
      return { bezeichnung, betragEur };
    });
    const email = String(formData.get('email') ?? '').trim();
    input = { kunde, positionen, ...(email ? { email } : {}) };
  } else {
    // Generic fallback for future catalog skills: validated JSON input.
    const raw = String(formData.get('inputJson') ?? '{}');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Input must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Input must be a JSON object.');
    }
    input = parsed as SkillJson;
  }

  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });

  // Rolle des Auslösers aus der VERIFIZIERTEN Session in den Input spiegeln —
  // Skills mit Wissens-Retrieval (holeWissen) filtern damit rollenbewusst
  // (Disclosure). Serverseitig gesetzt, überschreibt jeden Client-Wert.
  input = { ...input, rolle: role };

  // "Probelauf"-Toggle: gesetzt ⇒ Simulation (Guardrails laufen, acts-Steps
  // werden nur simuliert, nichts verlässt das System).
  const mode = formData.get('dryRun') ? 'simulation' : 'live';

  const rawClientId = String(formData.get('clientId') ?? '').trim();
  // Optional client link: empty = none; non-empty must be a UUID (fail-closed).
  let clientId: string | null = null;
  if (rawClientId) {
    if (!isUuid(rawClientId)) throw new Error('Invalid clientId.');
    clientId = rawClientId;
  }

  const handle = await startRun(orgId, skill.key, input, { mode, clientId });

  // Refresh the shell (approvals badge) + list views.
  revalidatePath('/dashboard', 'layout');
  redirect(`/dashboard/runs/${handle.runId}`);
}
