'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { ensureOrgAndMembership } from '@/lib/org';
import { listSkills, startRun, type SkillJson } from '@/lib/skills';

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
  if (!skill) throw new Error(`Unbekannter Skill: ${JSON.stringify(skillKey)}`);

  let input: SkillJson;
  if (skill.key === 'beleg_kontieren') {
    const beschreibung = String(formData.get('beschreibung') ?? '').trim();
    const betragEur = Number.parseFloat(
      String(formData.get('betragEur') ?? '').replace(',', '.'),
    );
    const belegNummer = String(formData.get('belegNummer') ?? '').trim();
    if (!beschreibung) throw new Error('Beschreibung ist erforderlich.');
    if (!Number.isFinite(betragEur) || betragEur <= 0) {
      throw new Error('Betrag (EUR) muss eine positive Zahl sein.');
    }
    input = { beschreibung, betragEur, ...(belegNummer ? { belegNummer } : {}) };
  } else if (skill.key === 'wissen_zusammenfassen') {
    const frage = String(formData.get('frage') ?? '').trim();
    if (!frage) throw new Error('Frage/Thema ist erforderlich.');
    input = { frage };
  } else if (skill.key === 'angebot_erstellen') {
    const kunde = String(formData.get('kunde') ?? '').trim();
    const leistung = String(formData.get('leistung') ?? '').trim();
    const betragEur = Number.parseFloat(
      String(formData.get('betragEur') ?? '').replace(',', '.'),
    );
    if (!kunde) throw new Error('Kunde ist erforderlich.');
    if (!leistung) throw new Error('Leistung ist erforderlich.');
    if (!Number.isFinite(betragEur) || betragEur <= 0) {
      throw new Error('Betrag (EUR) muss eine positive Zahl sein.');
    }
    const email = String(formData.get('email') ?? '').trim();
    input = { kunde, leistung, betragEur, ...(email ? { email } : {}) };
  } else if (skill.key === 'rechnung_erstellen') {
    const kunde = String(formData.get('kunde') ?? '').trim();
    if (!kunde) throw new Error('Kunde ist erforderlich.');
    // Eine Position pro Zeile: "Bezeichnung; Betrag" (Komma oder Punkt).
    const zeilen = String(formData.get('positionen') ?? '')
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean);
    if (zeilen.length === 0) throw new Error('Mindestens eine Position ist erforderlich.');
    const positionen = zeilen.map((zeile, i) => {
      const [bezeichnung, betragRaw] = zeile.split(';').map((s) => s.trim());
      const betragEur = Number.parseFloat(String(betragRaw ?? '').replace(',', '.'));
      if (!bezeichnung || !Number.isFinite(betragEur) || betragEur <= 0) {
        throw new Error(`Position ${i + 1}: erwartet "Bezeichnung; Betrag" mit positivem Betrag.`);
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
      throw new Error('Input muss gültiges JSON sein.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Input muss ein JSON-Objekt sein.');
    }
    input = parsed as SkillJson;
  }

  const { orgId, userId, clerkOrgId, orgSlug, role } = await requireTenant();
  await ensureOrgAndMembership({ clerkOrgId, name: orgSlug ?? clerkOrgId, userId, role });

  // Rolle des Auslösers aus der VERIFIZIERTEN Session in den Input spiegeln —
  // Skills mit Wissens-Retrieval (holeWissen) filtern damit rollenbewusst
  // (Disclosure). Serverseitig gesetzt, überschreibt jeden Client-Wert.
  input = { ...input, rolle: role };

  const handle = await startRun(orgId, skill.key, input);

  // Refresh the shell (approvals badge) + list views.
  revalidatePath('/dashboard', 'layout');
  redirect(`/dashboard/runs/${handle.runId}`);
}
