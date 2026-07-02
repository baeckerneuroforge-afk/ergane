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

  const handle = await startRun(orgId, skill.key, input);

  // Refresh the shell (approvals badge) + list views.
  revalidatePath('/dashboard', 'layout');
  redirect(`/dashboard/runs/${handle.runId}`);
}
