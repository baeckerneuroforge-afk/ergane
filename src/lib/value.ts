// Automation value ("what does this buy us?") — assumptions + aggregation.
//
// The dashboard converts LIVE skill runs into saved hours and a USD equivalent
// (src/lib/money.ts is the single currency authority). The conversion factors
// are per-org ASSUMPTIONS stored on org_settings:
//   - hourly rate (USD/h), default DEFAULT_HOURLY_RATE_USD
//   - minutes saved per SUCCESSFUL run, per skill, defaults below
// NULL columns / missing map keys fall back to the code defaults, so a fresh
// org sees sensible numbers without setup.
//
// Same shape as src/lib/company.ts: writes run in withTenant() behind a
// server-side admin gate and are audited ('policy.changed' with { old, new });
// reads happen in the CALLER's tenant transaction.
//
// CRITICAL INVARIANT: every aggregation here filters mode='live'. A dry-run
// (mode='simulation') is never a real execution and must never inflate the
// value figures — tests/value-dashboard.test.ts pins this.
import type { Role } from '@prisma/client';
import { logAudit } from './audit';
import { getMemberRole } from './policies';
import { listSkills } from './skills';
import { withTenant, type Tx } from './tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

/** Default value of one saved hour (USD/h) — editable per org in settings. */
export const DEFAULT_HOURLY_RATE_USD = 60;

/** Default minutes saved per successful live run, per skill. */
export const DEFAULT_MINUTES_SAVED: Record<string, number> = {
  beleg_kontieren: 8,
  wissen_zusammenfassen: 20,
  angebot_erstellen: 45,
  rechnung_erstellen: 25,
};

/** Fallback for skills without an explicit default (new catalog entries). */
export const FALLBACK_MINUTES_SAVED = 15;

/** Guards against typos/abuse, mirrors the CHECK constraints of 0020. */
const MAX_HOURLY_RATE_USD = 100_000;
const MAX_MINUTES_SAVED = 24 * 60;

export interface ValueSettings {
  /** USD per saved hour. */
  hourlyRateUsd: number;
  /** Minutes saved per successful run, resolved for every catalog skill. */
  minutesPerSkill: Record<string, number>;
}

function defaultMinutes(skillKey: string): number {
  return DEFAULT_MINUTES_SAVED[skillKey] ?? FALLBACK_MINUTES_SAVED;
}

/** Read the org's value assumptions in the CALLER's tenant transaction,
 * resolved against the defaults — every catalog skill has a value. */
export async function getValueSettings(tx: Tx, orgId: string): Promise<ValueSettings> {
  const row = await tx.orgSettings.findUnique({
    where: { orgId },
    select: { valueHourlyRateUsd: true, valueMinutesPerSkill: true },
  });

  const stored =
    row?.valueMinutesPerSkill && typeof row.valueMinutesPerSkill === 'object'
      ? (row.valueMinutesPerSkill as Record<string, unknown>)
      : {};

  const minutesPerSkill: Record<string, number> = {};
  for (const skill of listSkills()) {
    const raw = stored[skill.key];
    minutesPerSkill[skill.key] =
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
        ? raw
        : defaultMinutes(skill.key);
  }

  return {
    hourlyRateUsd: row?.valueHourlyRateUsd?.toNumber() ?? DEFAULT_HOURLY_RATE_USD,
    minutesPerSkill,
  };
}

export interface SetValueSettingsInput {
  orgId: string;
  /** The changing human — must be an admin of this tenant. */
  actorUserId: string;
  hourlyRateUsd: number;
  /** Minutes saved per successful run, keyed by catalog skill key. */
  minutesPerSkill: Record<string, number>;
}

export async function setValueSettings(input: SetValueSettingsInput): Promise<ValueSettings> {
  if (
    !Number.isFinite(input.hourlyRateUsd) ||
    input.hourlyRateUsd <= 0 ||
    input.hourlyRateUsd > MAX_HOURLY_RATE_USD
  ) {
    throw new Error(`Hourly rate (USD) must be a positive number up to ${MAX_HOURLY_RATE_USD}.`);
  }

  const knownKeys = new Set(listSkills().map((s) => s.key));
  const minutes: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.minutesPerSkill)) {
    if (!knownKeys.has(key)) throw new Error(`Unknown skill: ${JSON.stringify(key)}`);
    if (!Number.isFinite(value) || value < 0 || value > MAX_MINUTES_SAVED) {
      throw new Error(
        `Minutes saved for ${JSON.stringify(key)} must be between 0 and ${MAX_MINUTES_SAVED}.`,
      );
    }
    minutes[key] = value;
  }

  return withTenant(input.orgId, async (tx) => {
    const role = await getMemberRole(tx, input.actorUserId);
    if (!role || !ADMIN_ROLES.includes(role)) {
      throw new Error(
        `value: user ${JSON.stringify(input.actorUserId)} (role: ${role ?? 'none'}) may not change the value assumptions — admin required.`,
      );
    }

    const old = await getValueSettings(tx, input.orgId);
    await tx.orgSettings.upsert({
      where: { orgId: input.orgId },
      create: {
        orgId: input.orgId,
        valueHourlyRateUsd: input.hourlyRateUsd,
        valueMinutesPerSkill: minutes,
      },
      update: {
        valueHourlyRateUsd: input.hourlyRateUsd,
        valueMinutesPerSkill: minutes,
      },
    });
    const next = await getValueSettings(tx, input.orgId);

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: 'org_settings:value_assumptions',
      detail: { old, new: next },
    });
    return next;
  });
}

// -----------------------------------------------------------------------------
// Aggregation — LIVE runs only, always inside the caller's tenant transaction.
// -----------------------------------------------------------------------------

export interface SkillValueRow {
  skillKey: string;
  /** Live runs started in the period (any status). */
  runs: number;
  completed: number;
  savedHours: number;
  savedUsd: number;
}

export interface MonthValueRow {
  /** Bucket key 'YYYY-MM' (UTC). */
  month: string;
  runs: number;
  completed: number;
  savedHours: number;
  savedUsd: number;
}

export interface ValueStats {
  settings: ValueSettings;
  /** Live runs started in the period, any status. Simulations NEVER count. */
  totalRuns: number;
  completedRuns: number;
  /** rejected + failed. */
  rejectedOrFailedRuns: number;
  /** completed / (completed + rejected + failed); null while nothing decided. */
  successRate: number | null;
  savedHours: number;
  savedUsd: number;
  perSkill: SkillValueRow[];
  months: MonthValueRow[];
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aggregate the tenant's automation value for runs started at/after `since`.
 * Runs in the caller's withTenant() transaction (RLS scopes it to one org);
 * value accrues only for COMPLETED live runs — a paused/failed/rejected run
 * saved nobody any time, and a simulation is excluded by the mode filter.
 */
export async function computeValueStats(
  tx: Tx,
  orgId: string,
  { since }: { since: Date },
): Promise<ValueStats> {
  const settings = await getValueSettings(tx, orgId);

  // The mode filter is THE load-bearing line of this feature: dry-runs
  // (mode='simulation') must never reach any of the sums below.
  const runs = await tx.skillRun.findMany({
    where: { mode: 'live', createdAt: { gte: since } },
    select: { skillKey: true, status: true, createdAt: true },
  });

  const minutesOf = (skillKey: string) =>
    settings.minutesPerSkill[skillKey] ?? defaultMinutes(skillKey);

  const perSkill = new Map<string, SkillValueRow>();
  const months = new Map<string, MonthValueRow>();
  let completedRuns = 0;
  let rejectedOrFailedRuns = 0;
  let savedMinutes = 0;

  for (const run of runs) {
    const completed = run.status === 'completed';
    if (completed) completedRuns += 1;
    if (run.status === 'rejected' || run.status === 'failed') rejectedOrFailedRuns += 1;
    const minutes = completed ? minutesOf(run.skillKey) : 0;
    savedMinutes += minutes;

    const skillRow = perSkill.get(run.skillKey) ?? {
      skillKey: run.skillKey,
      runs: 0,
      completed: 0,
      savedHours: 0,
      savedUsd: 0,
    };
    skillRow.runs += 1;
    if (completed) skillRow.completed += 1;
    skillRow.savedHours += minutes / 60;
    perSkill.set(run.skillKey, skillRow);

    const key = monthKey(run.createdAt);
    const monthRow = months.get(key) ?? {
      month: key,
      runs: 0,
      completed: 0,
      savedHours: 0,
      savedUsd: 0,
    };
    monthRow.runs += 1;
    if (completed) monthRow.completed += 1;
    monthRow.savedHours += minutes / 60;
    months.set(key, monthRow);
  }

  const finish = <T extends { savedHours: number; savedUsd: number }>(row: T): T => ({
    ...row,
    savedHours: round2(row.savedHours),
    savedUsd: round2(row.savedHours * settings.hourlyRateUsd),
  });

  const decided = completedRuns + rejectedOrFailedRuns;
  const savedHours = round2(savedMinutes / 60);

  return {
    settings,
    totalRuns: runs.length,
    completedRuns,
    rejectedOrFailedRuns,
    successRate: decided > 0 ? completedRuns / decided : null,
    savedHours,
    savedUsd: round2(savedHours * settings.hourlyRateUsd),
    perSkill: [...perSkill.values()].map(finish).sort((a, b) => b.savedUsd - a.savedUsd),
    months: [...months.values()].map(finish).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
