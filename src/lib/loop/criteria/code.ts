// Deterministic criteria for source=code observations (commits/PRs).
import type { Observation } from '../sources/types';
import type { AcceptanceCriteriaSet, AcceptanceCriterion, CriterionResult } from './types';
import { hasTicketRef } from '../../connectors/github/normalize';

const commitHasTicketRef: AcceptanceCriterion = {
  key: 'commit_without_ticket',
  label: 'Commit/PR references a ticket',
  check: (obs: Observation): CriterionResult => {
    // Prefer structured meta from ingest; fall back to content string search.
    const metaHas = obs.metadata.hasTicketRef;
    if (typeof metaHas === 'boolean') {
      return {
        key: 'commit_without_ticket',
        passed: metaHas,
        detail: {
          expected: 'ticket ref (e.g. ENG-123)',
          actual: metaHas ? 'present' : 'missing',
          message: metaHas
            ? 'Ticket reference found'
            : 'Commit/PR has no ticket reference (ABC-123)',
        },
      };
    }
    const text =
      (typeof obs.metadata.message === 'string' ? obs.metadata.message : null) ??
      (typeof obs.metadata.text === 'string' ? obs.metadata.text : null) ??
      obs.content ??
      '';
    const found = hasTicketRef(text);
    return {
      key: 'commit_without_ticket',
      passed: found,
      detail: {
        expected: 'ticket ref (e.g. ENG-123)',
        actual: found ? 'present' : 'missing',
        message: found
          ? 'Ticket reference found'
          : 'Commit/PR has no ticket reference (ABC-123)',
      },
    };
  },
};

export const codeCriteria: AcceptanceCriteriaSet = {
  type: 'code',
  criteria: [commitHasTicketRef],
};
