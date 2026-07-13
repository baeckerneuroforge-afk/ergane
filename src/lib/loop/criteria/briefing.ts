// Acceptance criteria for deliverable type 'briefing' (P3-C).
import type { Observation } from '../sources/types';
import type { AcceptanceCriteriaSet, AcceptanceCriterion, CriterionResult } from './types';

export const BRIEFING_MIN_LENGTH = 200;

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

export function buildBriefingCriteria(overrides?: {
  min_length?: number;
}): AcceptanceCriteriaSet {
  const minLen = overrides?.min_length ?? BRIEFING_MIN_LENGTH;

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

  const hasDecisions: AcceptanceCriterion = {
    key: 'has_decisions',
    label: 'Has decisions / next conversation section',
    check: (obs: Observation): CriterionResult => {
      const content = obs.content ?? '';
      const found =
        hasHeading(content, /decisions?/i) ||
        hasHeading(content, /entscheidungen/i) ||
        hasHeading(content, /next\s+conversation/i) ||
        hasHeading(content, /nächstes\s+gespräch|naechstes\s+gespraech/i);
      return {
        key: 'has_decisions',
        passed: found,
        detail: {
          expected: 'decisions or next conversation section',
          actual: found ? 'present' : 'missing',
          message: found ? 'Decision section found' : 'Decision/next section missing',
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
          message: ok ? 'Sources present' : 'Sources missing',
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
    type: 'briefing',
    criteria: [hasExecutiveSummary, hasDecisions, hasSourcesCrit, minLength],
  };
}

export const briefingCriteria: AcceptanceCriteriaSet = buildBriefingCriteria();
