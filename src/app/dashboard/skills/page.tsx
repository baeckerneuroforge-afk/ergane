import type { ApprovalPolicy } from '@prisma/client';
import { requireTenant } from '@/lib/auth-context';
import { getApprovalPolicy } from '@/lib/policies';
import { listSkills } from '@/lib/skills';
import { GUARDRAIL_LIMIT_EUR } from '@/lib/skills/catalog/beleg_kontieren';
import type { SkillDef } from '@/lib/skills';
import { formatEuro } from '../ui';
import { startSkillRun } from './actions';

export const dynamic = 'force-dynamic';

/** Human-readable "when does a human have to approve" line per skill. */
function guardrailInfo(skill: SkillDef, policy: ApprovalPolicy | null): string {
  if (policy) {
    if (policy.mode === 'always') return 'Freigabe: immer erforderlich (Policy)';
    if (policy.mode === 'threshold' && policy.thresholdAmount) {
      return `Freigabe ab ${formatEuro(policy.thresholdAmount.toNumber())} (Policy)`;
    }
    if (policy.mode === 'never') {
      return skill.handlesMoney
        ? 'Policy „nie" — bei Geld-Skills nicht abschaltbar, Guardrail greift'
        : 'Freigabe: keine (Policy)';
    }
  }
  if (skill.key === 'beleg_kontieren') {
    return `Freigabe ab ${formatEuro(GUARDRAIL_LIMIT_EUR)} (Guardrail)`;
  }
  if (skill.guardrail) return 'Guardrail aktiv — Freigabe bei Auslösung';
  return skill.handlesMoney ? 'Freigabe: immer erforderlich' : 'Keine Freigabe nötig';
}

export default async function SkillsPage() {
  const { orgId } = await requireTenant();
  const skills = listSkills();
  const policies = await Promise.all(skills.map((s) => getApprovalPolicy(orgId, s.key)));

  return (
    <>
      <p className="page-intro">
        Skills sind deklarierte Abläufe der Engine: lesende Schritte laufen frei, handelnde
        Schritte stehen hinter Guardrail und menschlicher Freigabe.
      </p>

      <div className="quick-grid">
        {skills.map((skill, i) => {
          const acts = skill.steps.some((s) => s.acts);
          return (
            <section className="card" key={skill.key} style={{ display: 'grid', gap: '0.6rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{skill.title}</strong>
                <span className={`chip ${acts ? 'chip--orange' : 'chip--indigo'}`}>
                  {acts ? 'handelt' : 'liest nur'}
                </span>
              </div>
              <div>
                <span className="chip">{skill.key}</span>
              </div>
              <div className="row-meta">{guardrailInfo(skill, policies[i])}</div>

              <form action={startSkillRun} style={{ marginTop: '0.4rem' }}>
                <input type="hidden" name="skillKey" value={skill.key} />
                {skill.key === 'beleg_kontieren' ? (
                  <>
                    <label htmlFor={`besch-${skill.key}`}>Beschreibung</label>
                    <input
                      id={`besch-${skill.key}`}
                      name="beschreibung"
                      placeholder="z. B. Softwarelizenz Jahresvertrag"
                      required
                    />
                    <label htmlFor={`betrag-${skill.key}`}>Betrag (EUR)</label>
                    <input
                      id={`betrag-${skill.key}`}
                      name="betragEur"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="z. B. 1240,00"
                      required
                    />
                    <label htmlFor={`beleg-${skill.key}`}>Belegnummer (optional)</label>
                    <input id={`beleg-${skill.key}`} name="belegNummer" placeholder="B-2026-…" />
                  </>
                ) : (
                  <>
                    <label htmlFor={`input-${skill.key}`}>Input (JSON)</label>
                    <textarea id={`input-${skill.key}`} name="inputJson" rows={4} defaultValue="{}" />
                  </>
                )}
                <button type="submit" className="btn btn--primary">
                  Ausführen
                </button>
              </form>
            </section>
          );
        })}
      </div>
    </>
  );
}
