// Loop autonomy level — the org-wide governance knob for how sharply the loop
// acts on a deviation (Schritt D, plan §4). Two layers, never confused:
//   1. RLS + FORCE (migration 0012) is the hard floor: every read/write here
//      runs in withTenant(), so a tenant only ever sees and edits its OWN
//      setting.
//   2. This value configures BEHAVIOUR within a tenant: 'report' (Default) just
//      flags + notifies; 'suggest' additionally attaches a correction proposal a
//      human triggers; 'autonomous' also attaches the proposal AND the loop
//      auto-starts the correction itself (Schritt E) — still behind the approval
//      gate + a daily limit + anti-loop guard (see shouldAutoStart / auto-correct.ts).
//
// Fail-closed default: no org_settings row, or the field somehow unreadable,
// ⇒ 'report' — the safe, unchanged behaviour, never a surprise suggestion.
//
// Only 'admin' (or the explicitly elevated 'owner') may change the level; every
// change writes audit 'policy.changed' with { old, new } — the EXACT pattern of
// setApprovalPolicy (src/lib/policies/index.ts).

import type { LoopAutonomy } from '@prisma/client';
import { logAudit } from '../audit';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../i18n';
import { requireAdmin } from '../policies/admin';
import { withTenant, type Tx } from '../tenant';

export type { LoopAutonomy };

/** The safe default when nothing is stored (or on any read fallback). */
export const DEFAULT_LOOP_AUTONOMY: LoopAutonomy = 'report';

/** The levels a user may pick — the full enum. Ordered least→most active. */
export const LOOP_AUTONOMY_LEVELS: LoopAutonomy[] = ['report', 'suggest', 'autonomous'];

/**
 * The autonomy level for a tenant, defaulting to 'report' when there is no
 * settings row yet. Read-only; runs inside withTenant (RLS-scoped).
 */
export async function getLoopAutonomy(orgId: string): Promise<LoopAutonomy> {
  const settings = await withTenant(orgId, (tx) =>
    tx.orgSettings.findUnique({ where: { orgId }, select: { loopAutonomy: true } }),
  );
  return settings?.loopAutonomy ?? DEFAULT_LOOP_AUTONOMY;
}

/**
 * The level's PROPOSAL behaviour, collapsed to two cases. Both 'suggest' and
 * 'autonomous' attach a correction proposal to a flag — the difference is only
 * WHO triggers it (a human click vs. the loop). So for the proposal-attachment
 * question they are the same, and mapping 'autonomous' → 'suggest' here lets the
 * flag paths ask one question (shouldSuggest) without special-casing. Whether the
 * loop ALSO auto-starts is a separate question — see shouldAutoStart (Schritt E).
 */
export function effectiveAutonomy(level: LoopAutonomy): LoopAutonomy {
  return level === 'autonomous' ? 'suggest' : level;
}

/** True when the level should attach a correction proposal to a flag. */
export function shouldSuggest(level: LoopAutonomy): boolean {
  return effectiveAutonomy(level) === 'suggest';
}

/**
 * True when the loop should AUTO-START the correction itself, without a human
 * click (Schritt E) — ONLY at 'autonomous'. The auto-started run still goes
 * through the normal approval gate; the loop starts, never approves. 'report'
 * and 'suggest' are always false here (suggest attaches the proposal but waits
 * for the human).
 */
export function shouldAutoStart(level: LoopAutonomy): boolean {
  return level === 'autonomous';
}

export interface AutonomyContext {
  autonomy: LoopAutonomy;
  locale: Locale;
  /** shouldSuggest(autonomy) — attach a correction proposal to the flag? */
  suggest: boolean;
  /** shouldAutoStart(autonomy) — should the loop auto-start the correction (Schritt E)? */
  autoStart: boolean;
}

/**
 * Read the tenant's autonomy level + org locale in ONE org_settings query and
 * resolve both defaults. Shared by both flag paths (evaluate + tick) so the
 * "resolve autonomy + locale" step lives in one place. Runs on the caller's tx
 * (fast read); pass the tx you already hold. Fails closed to report/en.
 */
export async function resolveAutonomyContext(tx: Tx, orgId: string): Promise<AutonomyContext> {
  const settings = await tx.orgSettings.findUnique({
    where: { orgId },
    select: { loopAutonomy: true, locale: true },
  });
  const autonomy = settings?.loopAutonomy ?? DEFAULT_LOOP_AUTONOMY;
  const locale: Locale = isLocale(settings?.locale) ? settings.locale : DEFAULT_LOCALE;
  return {
    autonomy,
    locale,
    suggest: shouldSuggest(autonomy),
    autoStart: shouldAutoStart(autonomy),
  };
}

export interface SetLoopAutonomyInput {
  orgId: string;
  /** The human changing the level — must hold the admin role in this org. */
  actorUserId: string;
  level: LoopAutonomy;
}

/**
 * Set the tenant's loop autonomy level. Admin-only (requireAdmin inside the same
 * withTenant tx), and every real change writes audit 'policy.changed' with
 * { old, new }. A no-op change (same level) writes nothing — no audit noise —
 * mirroring setVisibilityGrant / setMembershipRole.
 */
export async function setLoopAutonomy(input: SetLoopAutonomyInput): Promise<LoopAutonomy> {
  const { orgId, actorUserId, level } = input;
  if (!LOOP_AUTONOMY_LEVELS.includes(level)) {
    throw new Error(`setLoopAutonomy: level must be one of ${LOOP_AUTONOMY_LEVELS.join('|')}.`);
  }

  return withTenant(orgId, async (tx) => {
    await requireAdmin(tx, orgId, actorUserId);

    const old = await tx.orgSettings.findUnique({
      where: { orgId },
      select: { loopAutonomy: true },
    });
    const oldLevel = old?.loopAutonomy ?? DEFAULT_LOOP_AUTONOMY;
    if (old && oldLevel === level) return level; // no change, no audit noise

    await tx.orgSettings.upsert({
      where: { orgId },
      create: { orgId, loopAutonomy: level },
      update: { loopAutonomy: level },
    });

    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: 'org_settings:loop_autonomy',
      detail: { old: oldLevel, new: level },
    });
    return level;
  });
}
