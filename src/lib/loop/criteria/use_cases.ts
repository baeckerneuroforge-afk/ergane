// Deterministic acceptance criteria for deliverable type 'use_cases'.
import type { Observation } from '../sources/types';
import type { AcceptanceCriteriaSet, AcceptanceCriterion, CriterionResult } from './types';

export const USE_CASES_MIN_ITEMS = 3;
export const USE_CASES_MIN_LENGTH = 300;

function countNumberedItems(markdown: string): number {
  let count = 0;
  let inSection = false;
  for (const line of markdown.split('\n')) {
    if (/^##\s+/.test(line)) {
      const h = line.replace(/^##\s+/, '').trim();
      inSection = /use\s*cases?/i.test(h) || /priorisierte\s+use/i.test(h);
      continue;
    }
    if (inSection && /^\s*\d+\.\s+\S/.test(line)) count++;
  }
  // Fallback: any numbered list in the doc if section heading missing.
  if (count === 0) {
    for (const line of markdown.split('\n')) {
      if (/^\s*\d+\.\s+\S/.test(line)) count++;
    }
  }
  return count;
}

function hasHeading(markdown: string, re: RegExp): boolean {
  return markdown.split('\n').some((line) => {
    if (!/^##?\s+/.test(line)) return false;
    return re.test(line.replace(/^##?\s+/, '').trim());
  });
}

function hasSources(markdown: string): boolean {
  for (const line of markdown.split('\n')) {
    const t = line.trim().replace(/^_/, '').replace(/_$/, '');
    if (t.startsWith('Sources:') || t.startsWith('Quellen:')) {
      return t.slice(t.indexOf(':') + 1).trim().length > 0;
    }
  }
  return false;
}

/** Optional numeric overrides (from org_settings.loop_criteria_overrides.use_cases). */
export interface UseCasesCriteriaThresholds {
  min_use_cases?: number;
  min_length?: number;
}

export function buildUseCasesCriteria(
  overrides: UseCasesCriteriaThresholds = {},
): AcceptanceCriteriaSet {
  const minItems = overrides.min_use_cases ?? USE_CASES_MIN_ITEMS;
  const minLen = overrides.min_length ?? USE_CASES_MIN_LENGTH;

  const minUseCases: AcceptanceCriterion = {
    key: 'min_use_cases',
    label: 'Minimum use cases',
    check: (obs: Observation): CriterionResult => {
      const count = countNumberedItems(obs.content ?? '');
      return {
        key: 'min_use_cases',
        passed: count >= minItems,
        detail: {
          expected: minItems,
          actual: count,
          message:
            count >= minItems
              ? `Found ${count} use case(s)`
              : `Found ${count} use case(s), expected at least ${minItems}`,
        },
      };
    },
  };

  const hasExecutiveSummary: AcceptanceCriterion = {
    key: 'has_executive_summary',
    label: 'Has executive summary',
    check: (obs: Observation): CriterionResult => {
      const found = hasHeading(obs.content ?? '', /^executive\s+summary$/i);
      return {
        key: 'has_executive_summary',
        passed: found,
        detail: {
          expected: 'present',
          actual: found ? 'present' : 'missing',
          message: found ? 'Executive summary found' : 'Executive summary missing',
        },
      };
    },
  };

  const hasSourcesCrit: AcceptanceCriterion = {
    key: 'has_sources',
    label: 'Has sources attribution',
    check: (obs: Observation): CriterionResult => {
      const ok = hasSources(obs.content ?? '');
      return {
        key: 'has_sources',
        passed: ok,
        detail: {
          expected: '≥ 1 source',
          actual: ok ? 'present' : 'missing',
          message: ok ? 'Sources line present' : 'Sources line missing or empty',
        },
      };
    },
  };

  const minLength: AcceptanceCriterion = {
    key: 'min_length',
    label: 'Minimum content length',
    check: (obs: Observation): CriterionResult => {
      const length = (obs.content ?? '').replace(/\s/g, '').length;
      return {
        key: 'min_length',
        passed: length >= minLen,
        detail: {
          expected: minLen,
          actual: length,
          message:
            length >= minLen
              ? `Content has ${length} non-whitespace characters`
              : `Content has ${length} characters, expected ≥ ${minLen}`,
        },
      };
    },
  };

  return {
    type: 'use_cases',
    criteria: [minUseCases, hasExecutiveSummary, hasSourcesCrit, minLength],
  };
}

export const useCasesCriteria: AcceptanceCriteriaSet = buildUseCasesCriteria();
