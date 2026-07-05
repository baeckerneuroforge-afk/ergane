import type { Prisma } from '@prisma/client';
import { logAudit } from '../audit';
import { getDictionary } from '../i18n';
import { getSkill } from '../skills';
import { withTenant } from '../tenant';
import { maybeAutoCorrect } from './auto-correct';
import { frameworkCriteria } from './criteria/framework';
import type { AcceptanceCriteriaSet, CriterionResult } from './criteria/types';
import { toFlagView } from './flags-view';
import { notifyFlag } from './notify';
import { resolveAutonomyContext } from './settings';
import { buildSuggestedActionText, type CorrectionRef } from './suggest';
import { observationForArtifact } from './sources/deliverable';

const LOOP_ACTOR = 'loop-engine';

export interface DeliverableTrace {
  v: 1;
  artifactId: string;
  type: string;
  criteria: CriterionResult[];
  passedCount: number;
  failedCount: number;
  flagRaised: boolean;
}

const CRITERIA_BY_TYPE: Record<string, AcceptanceCriteriaSet> = {
  framework: frameworkCriteria,
};

function findArtifactId(state: Record<string, Record<string, unknown>>): string | null {
  for (const stepDetail of Object.values(state)) {
    if (typeof stepDetail.artifactId === 'string') return stepDetail.artifactId;
  }
  return null;
}

function findArtifactType(state: Record<string, Record<string, unknown>>): string | null {
  for (const stepDetail of Object.values(state)) {
    if (stepDetail.generiert === true && typeof stepDetail.artifactId === 'string') {
      return 'framework';
    }
  }
  return null;
}

/**
 * Evaluate deliverable acceptance criteria at the end of a skill run.
 *
 * THE NON-NEGOTIABLE RULE:
 *   - Blob loading + criteria checking happen OUTSIDE any withTenant transaction.
 *   - ONLY the trace write + flag audit entry run in a SHORT withTenant transaction.
 *   - No LLM call anywhere — all criteria are purely deterministic.
 */
export async function evaluateDeliverableCriteria(
  orgId: string,
  skillKey: string,
  runId: string,
  state: Record<string, Record<string, unknown>>,
): Promise<DeliverableTrace | null> {
  const artifactId = findArtifactId(state);
  if (!artifactId) return null;

  const artifactType = findArtifactType(state);
  if (!artifactType) return null;

  const criteriaSet = CRITERIA_BY_TYPE[artifactType];
  if (!criteriaSet) return null;

  // OUTSIDE any transaction: load blob content, build observation, check criteria.
  const observation = await observationForArtifact(orgId, artifactId);
  if (!observation) return null;

  const results: CriterionResult[] = criteriaSet.criteria.map((c) => c.check(observation));

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const flagRaised = failedCount > 0;

  const trace: DeliverableTrace = {
    v: 1,
    artifactId,
    type: artifactType,
    criteria: results,
    passedCount,
    failedCount,
    flagRaised,
  };

  // BEFORE the flag tx: build the correction proposal (autonomy 'suggest'/
  // 'autonomous'). Its reads (autonomy, org locale, client name) run in their
  // OWN short tx so they can NEVER abort the flag write — a criteria flag must be
  // persisted exactly as reliably in 'suggest' mode as in 'report' mode. Returns
  // {} in 'report' mode. Only builds when a flag will actually be raised.
  const clientId =
    typeof observation.metadata.clientId === 'string' ? observation.metadata.clientId : null;
  const proposal = flagRaised ? await buildProposal(orgId, skillKey, runId, clientId) : {};

  // SHORT transaction: write trace + flag audit entry ONLY. No proposal reads
  // here — the tx stays minimal (trace update + one logAudit), so a flag is
  // never lost to an unrelated read failing.
  const flagRow = await withTenant(orgId, async (tx) => {
    await tx.skillRun.update({
      where: { id: runId },
      data: { trace: trace as unknown as Prisma.InputJsonValue },
    });

    if (!flagRaised) return null;

    const failed = results.filter((r) => !r.passed);
    return logAudit(tx, {
      orgId,
      actorId: LOOP_ACTOR,
      actorType: 'agent',
      action: 'flag.criteria_violated',
      target: artifactId,
      detail: {
        category: 'criteria',
        type: artifactType,
        skillKey,
        runId,
        failedCriteria: failed.map((r) => ({
          criterion: r.key,
          expected: r.detail.expected,
          actual: r.detail.actual,
          message: r.detail.message,
        })),
        passedCount,
        failedCount,
        severity: failedCount >= 3 ? 'critical' : 'warning',
        // Only present under 'suggest'/'autonomous'; absent under 'report'.
        ...proposal,
      },
    });
  });

  // AFTER the commit (best-effort, never touching the flag tx): notify + maybe
  // auto-correct. Both leave the already-committed flag untouched on any failure.
  if (flagRow) {
    await notifyFlag(orgId, toFlagView(flagRow));

    // Schritt E: at autonomy 'autonomous', the loop auto-starts the correction
    // ITSELF (no human click). Only criteria flags carry a `correction` re-run
    // pointer, so only they can auto-start. maybeAutoCorrect is self-contained
    // (re-checks autonomy + the anti-loop + daily-limit brakes) and never throws;
    // the started run still goes through the normal approval gate. A non-
    // autonomous tenant gets a silent no-op here.
    if (proposal.correction) {
      await maybeAutoCorrect(orgId, proposal.correction);
    }
  }

  return trace;
}

/**
 * Build the correction proposal for a criteria flag, gated on the tenant's
 * autonomy level. Returns `{}` under 'report' (no proposal, no button) and
 * `{ suggestedAction, correction }` under 'suggest'/'autonomous'. Opens its OWN
 * short tx for the reads (autonomy, org locale, client name) so it is fully
 * decoupled from the flag-write tx — and NEVER throws: any read failure degrades
 * to `{}` (no proposal) rather than losing the flag. The returned `correction`
 * is the re-run pointer /api/loop/correct replays.
 */
async function buildProposal(
  orgId: string,
  skillKey: string,
  runId: string,
  clientId: string | null,
): Promise<{ suggestedAction?: string; correction?: CorrectionRef }> {
  try {
    const { locale, suggest, clientName } = await withTenant(orgId, async (tx) => {
      const ctx = await resolveAutonomyContext(tx, orgId);
      let name: string | null = null;
      if (ctx.suggest && clientId) {
        const client = await tx.client.findUnique({
          where: { id: clientId },
          select: { name: true },
        });
        name = client?.name ?? null;
      }
      return { locale: ctx.locale, suggest: ctx.suggest, clientName: name };
    });
    if (!suggest) return {};

    // Localized skill title, falling back to the registry title then the key.
    let skillTitle = skillKey;
    try {
      skillTitle = getDictionary(locale).skillTitles[skillKey] ?? getSkill(skillKey).title;
    } catch {
      // Unknown skill key — keep the key as the title rather than throwing.
    }

    return {
      suggestedAction: buildSuggestedActionText(locale, skillTitle, clientName),
      correction: { skillKey, sourceRunId: runId, clientId },
    };
  } catch {
    // A read failed — degrade to no proposal. The flag is written regardless.
    return {};
  }
}
