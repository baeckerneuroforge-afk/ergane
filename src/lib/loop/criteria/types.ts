import type { Observation } from '../sources/types';

export interface CriterionResult {
  key: string;
  passed: boolean;
  detail: {
    expected: unknown;
    actual: unknown;
    message: string;
  };
}

export interface AcceptanceCriterion {
  key: string;
  label: string;
  check: (obs: Observation) => CriterionResult;
}

export interface AcceptanceCriteriaSet {
  type: string;
  criteria: AcceptanceCriterion[];
}
