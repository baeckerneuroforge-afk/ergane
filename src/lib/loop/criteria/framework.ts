import { FRAMEWORK_SECTIONS } from '../../skills/catalog/framework-sections';
import type { Observation } from '../sources/types';
import type { AcceptanceCriteriaSet, AcceptanceCriterion, CriterionResult } from './types';

export const MIN_USE_CASES = 3;
export const MIN_LENGTH_CHARS = 500;

const SOURCES_MARKERS = ['Sources:', 'Quellen:'];

function extractH2Headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

function countUseCases(markdown: string): number {
  const lines = markdown.split('\n');
  let inUseCasesSection = false;
  let count = 0;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      const heading = line.replace(/^##\s+/, '').trim();
      inUseCasesSection =
        /use\s*cases?/i.test(heading) || /priorisierte\s+use\s*cases?/i.test(heading);
      continue;
    }
    if (inUseCasesSection && /^\s*\d+\.\s+\S/.test(line)) {
      count++;
    }
  }
  return count;
}

const minUseCases: AcceptanceCriterion = {
  key: 'min_use_cases',
  label: 'Minimum use cases',
  check: (obs: Observation): CriterionResult => {
    const content = obs.content ?? '';
    const count = countUseCases(content);
    return {
      key: 'min_use_cases',
      passed: count >= MIN_USE_CASES,
      detail: {
        expected: MIN_USE_CASES,
        actual: count,
        message:
          count >= MIN_USE_CASES
            ? `Found ${count} use case(s)`
            : `Found ${count} use case(s), expected at least ${MIN_USE_CASES}`,
      },
    };
  },
};

const hasExecutiveSummary: AcceptanceCriterion = {
  key: 'has_executive_summary',
  label: 'Has executive summary',
  check: (obs: Observation): CriterionResult => {
    const headings = extractH2Headings(obs.content ?? '');
    const found = headings.some(
      (h) => h.toLowerCase() === 'executive summary',
    );
    return {
      key: 'has_executive_summary',
      passed: found,
      detail: {
        expected: 'present',
        actual: found ? 'present' : 'missing',
        message: found
          ? 'Executive summary section found'
          : 'Executive summary section missing',
      },
    };
  },
};

const hasAllSections: AcceptanceCriterion = {
  key: 'has_all_sections',
  label: 'Has all required sections',
  check: (obs: Observation): CriterionResult => {
    const headings = extractH2Headings(obs.content ?? '').map((h) =>
      h.toLowerCase(),
    );
    const allSections = [
      ...FRAMEWORK_SECTIONS.en.map((s) => s.toLowerCase()),
      ...FRAMEWORK_SECTIONS.de.map((s) => s.toLowerCase()),
    ];

    const required = FRAMEWORK_SECTIONS.en.length;
    let matched = 0;
    const missing: string[] = [];

    for (const en of FRAMEWORK_SECTIONS.en) {
      const de =
        FRAMEWORK_SECTIONS.de[FRAMEWORK_SECTIONS.en.indexOf(en)] ?? en;
      if (
        headings.some(
          (h) => h === en.toLowerCase() || h === de.toLowerCase(),
        )
      ) {
        matched++;
      } else {
        missing.push(en);
      }
    }

    return {
      key: 'has_all_sections',
      passed: matched >= required,
      detail: {
        expected: required,
        actual: matched,
        message:
          matched >= required
            ? `All ${required} sections present`
            : `Missing sections: ${missing.join(', ')}`,
      },
    };
  },
};

const hasSources: AcceptanceCriterion = {
  key: 'has_sources',
  label: 'Has sources attribution',
  check: (obs: Observation): CriterionResult => {
    const content = obs.content ?? '';
    const lines = content.split('\n');
    let sourceCount = 0;

    for (const line of lines) {
      const trimmed = line.trim().replace(/^_/, '').replace(/_$/, '');
      for (const marker of SOURCES_MARKERS) {
        if (trimmed.startsWith(marker)) {
          const rest = trimmed.slice(marker.length).trim();
          if (rest.length > 0) {
            sourceCount = rest.split(',').filter((s) => s.trim().length > 0).length;
          }
          break;
        }
      }
    }

    return {
      key: 'has_sources',
      passed: sourceCount >= 1,
      detail: {
        expected: '≥ 1 source',
        actual: sourceCount,
        message:
          sourceCount >= 1
            ? `Found ${sourceCount} source(s)`
            : 'No sources line found or sources list is empty',
      },
    };
  },
};

const minLength: AcceptanceCriterion = {
  key: 'min_length',
  label: 'Minimum content length',
  check: (obs: Observation): CriterionResult => {
    const content = obs.content ?? '';
    const length = content.replace(/\s/g, '').length;
    return {
      key: 'min_length',
      passed: length >= MIN_LENGTH_CHARS,
      detail: {
        expected: MIN_LENGTH_CHARS,
        actual: length,
        message:
          length >= MIN_LENGTH_CHARS
            ? `Content has ${length} non-whitespace characters`
            : `Content has ${length} non-whitespace characters, expected at least ${MIN_LENGTH_CHARS}`,
      },
    };
  },
};

export const frameworkCriteria: AcceptanceCriteriaSet = {
  type: 'framework',
  criteria: [minUseCases, hasExecutiveSummary, hasAllSections, hasSources, minLength],
};
