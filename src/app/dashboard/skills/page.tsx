import type { ApprovalPolicy } from '@prisma/client';
import { requireTenant } from '@/lib/auth-context';
import { getApprovalPolicy } from '@/lib/policies';
import { listSkills } from '@/lib/skills';
import { GUARDRAIL_LIMIT_EUR } from '@/lib/skills/catalog/beleg_kontieren';
import { RECHNUNG_GUARDRAIL_LIMIT_EUR } from '@/lib/skills/catalog/rechnung_erstellen';
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
  if (skill.key === 'rechnung_erstellen') {
    return `Freigabe ab ${formatEuro(RECHNUNG_GUARDRAIL_LIMIT_EUR)} Rechnungssumme (Guardrail)`;
  }
  if (skill.key === 'angebot_erstellen') {
    return 'Freigabe: immer — externe Kommunikation, unabhängig vom Betrag (Guardrail)';
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
                ) : skill.key === 'wissen_zusammenfassen' ? (
                  <>
                    <label htmlFor={`frage-${skill.key}`}>Frage / Thema</label>
                    <input
                      id={`frage-${skill.key}`}
                      name="frage"
                      placeholder="z. B. Wie viele Urlaubstage gibt es?"
                      required
                    />
                  </>
                ) : skill.key === 'angebot_erstellen' ? (
                  <>
                    <label htmlFor={`kunde-${skill.key}`}>Kunde</label>
                    <input
                      id={`kunde-${skill.key}`}
                      name="kunde"
                      placeholder="z. B. Hanse Logistik GmbH"
                      required
                    />
                    <label htmlFor={`leistung-${skill.key}`}>Leistung</label>
                    <input
                      id={`leistung-${skill.key}`}
                      name="leistung"
                      placeholder="z. B. Projektunterstützung Q3"
                      required
                    />
                    <label htmlFor={`betrag-${skill.key}`}>Betrag (EUR)</label>
                    <input
                      id={`betrag-${skill.key}`}
                      name="betragEur"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="z. B. 4800,00"
                      required
                    />
                    <label htmlFor={`email-${skill.key}`}>Empfänger-E-Mail (optional — leer = simulierter Versand)</label>
                    <input
                      id={`email-${skill.key}`}
                      name="email"
                      type="email"
                      placeholder="z. B. einkauf@kunde.de"
                    />
                  </>
                ) : skill.key === 'rechnung_erstellen' ? (
                  <>
                    <label htmlFor={`kunde-${skill.key}`}>Kunde</label>
                    <input
                      id={`kunde-${skill.key}`}
                      name="kunde"
                      placeholder="z. B. Möbelwerk Nord GmbH"
                      required
                    />
                    <label htmlFor={`pos-${skill.key}`}>Positionen (eine pro Zeile: Bezeichnung; Betrag)</label>
                    <textarea
                      id={`pos-${skill.key}`}
                      name="positionen"
                      rows={3}
                      placeholder={'Beratung März; 950\nWorkshoptag; 480'}
                      required
                    />
                    <label htmlFor={`email-${skill.key}`}>Empfänger-E-Mail (optional — leer = simulierter Versand)</label>
                    <input
                      id={`email-${skill.key}`}
                      name="email"
                      type="email"
                      placeholder="z. B. buchhaltung@kunde.de"
                    />
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
