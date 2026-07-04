import type { Prisma } from '@prisma/client';
import { logAudit } from '../audit';
import { withTenant } from '../tenant';
import { frameworkCriteria } from './criteria/framework';
import type { AcceptanceCriteriaSet, CriterionResult } from './criteria/types';
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

  // SHORT transaction: write trace + flag audit entry.
  await withTenant(orgId, async (tx) => {
    await tx.skillRun.update({
      where: { id: runId },
      data: { trace: trace as unknown as Prisma.InputJsonValue },
    });

    if (flagRaised) {
      const failed = results.filter((r) => !r.passed);
      await logAudit(tx, {
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
        },
      });
    }
  });

  return trace;
}
