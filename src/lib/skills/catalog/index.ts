// Skill catalog — the registry the engine resolves skill keys against.
// Adding a skill = adding a SkillDef here; the engine, tables and audit
// mechanics are shared.
import type { SkillDef } from '../types';
import { belegKontieren } from './beleg_kontieren';

const SKILLS: Record<string, SkillDef> = {
  [belegKontieren.key]: belegKontieren,
};

export function getSkill(key: string): SkillDef {
  const skill = SKILLS[key];
  if (!skill) throw new Error(`Unknown skill: ${JSON.stringify(key)}`);
  return skill;
}

export function listSkills(): SkillDef[] {
  return Object.values(SKILLS);
}
