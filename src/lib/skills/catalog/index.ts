// Skill catalog — the registry the engine resolves skill keys against.
// Adding a skill = adding a SkillDef here; the engine, tables and audit
// mechanics are shared.
import type { SkillDef } from '../types';
import { angebotErstellen } from './angebot_erstellen';
import { belegKontieren } from './beleg_kontieren';
import { linearKommentar } from './linear_kommentar';
import { rechnungErstellen } from './rechnung_erstellen';
import { transkriptZuBriefing } from './transkript_zu_briefing';
import { transkriptZuFramework } from './transkript_zu_framework';
import { transkriptZuUseCases } from './transkript_zu_use_cases';
import { wissenZusammenfassen } from './wissen_zusammenfassen';

const SKILLS: Record<string, SkillDef> = {
  [belegKontieren.key]: belegKontieren,
  [wissenZusammenfassen.key]: wissenZusammenfassen,
  [angebotErstellen.key]: angebotErstellen,
  [rechnungErstellen.key]: rechnungErstellen,
  [transkriptZuFramework.key]: transkriptZuFramework,
  [transkriptZuUseCases.key]: transkriptZuUseCases,
  [transkriptZuBriefing.key]: transkriptZuBriefing,
  [linearKommentar.key]: linearKommentar,
};

/** Test-only extras (durable multi-step fixtures). Never listed in listSkills(). */
const TEST_SKILLS: Record<string, SkillDef> = {};

/** Register a skill for the duration of a test (not in the product catalog). */
export function __registerSkillForTests(skill: SkillDef): void {
  TEST_SKILLS[skill.key] = skill;
}

/** Remove one or all test-only skills. */
export function __clearTestSkills(key?: string): void {
  if (key) delete TEST_SKILLS[key];
  else for (const k of Object.keys(TEST_SKILLS)) delete TEST_SKILLS[k];
}

export function getSkill(key: string): SkillDef {
  const skill = TEST_SKILLS[key] ?? SKILLS[key];
  if (!skill) throw new Error(`Unknown skill: ${JSON.stringify(key)}`);
  return skill;
}

export function listSkills(): SkillDef[] {
  return Object.values(SKILLS);
}
