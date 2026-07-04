import { describe, expect, it } from 'vitest';
import { frameworkCriteria, MIN_USE_CASES, MIN_LENGTH_CHARS } from '../src/lib/loop/criteria/framework';
import type { Observation } from '../src/lib/loop/sources/types';

function obs(content: string): Observation {
  return {
    sourceKey: 'deliverable',
    externalRef: 'test-artifact-id',
    type: 'framework',
    content,
    metadata: {},
    createdAt: new Date(),
  };
}

const check = (key: string, content: string) => {
  const criterion = frameworkCriteria.criteria.find((c) => c.key === key);
  if (!criterion) throw new Error(`Unknown criterion: ${key}`);
  return criterion.check(obs(content));
};

const GOOD_FRAMEWORK = [
  '# Framework - Acme Logistics',
  '',
  '## Executive summary',
  'Acme Logistics operates three warehouses with 200 employees across Northern Germany.',
  'The primary challenge is manual data entry consuming 30% of warehouse manager time.',
  'We recommend a phased digitalization starting with a self-service portal at Hamburg.',
  '',
  '## Situation',
  'The client currently relies on paper-based goods receipt processes and phone-based',
  'stock inquiries. Warehouse managers spend 2.5 hours daily on manual data entry into',
  'the legacy ERP. The Hamburg site processes 450 deliveries per week with 12% error rate.',
  '',
  '## Key themes & goals',
  '- Reduce manual data entry time by 50% within 6 months of rollout',
  '- Achieve a unified real-time inventory view across all three locations',
  '- Decrease goods receipt error rate from 12% to below 3%',
  '',
  '## Constraints',
  '- The legacy ERP system provides read-only API access via SOAP only',
  '- EU data residency is required for all inventory and personnel data',
  '- The IT team has capacity for one integration project per quarter',
  '',
  '## Prioritized use cases',
  '1. **Self-service stock inquiry portal** for warehouse staff to check stock levels',
  '2. **Unified cross-warehouse inventory dashboard** for real-time stock balancing',
  '3. **Scan-based automated goods receipt** to replace manual booking at the dock',
  '',
  '## Next steps',
  '1. Scope the pilot project at the Hamburg warehouse with the local team',
  '2. Set up read-only API access to the legacy ERP for the integration layer',
  '3. Define success metrics and measurement baseline before pilot launch',
  '',
  '---',
  '',
  '_Sources: Kickoff-Transkript Kunde Nordwind, Follow-Up Call Nordwind_',
].join('\n');

const MINIMAL_FRAMEWORK_MISSING_USE_CASES = [
  '## Executive summary',
  'Summary here.',
  '',
  '## Situation',
  'Situation here.',
  '',
  '## Key themes & goals',
  'Goals here.',
  '',
  '## Constraints',
  'Constraints here.',
  '',
  '## Prioritized use cases',
  '1. One use case only',
  '',
  '## Next steps',
  '1. Next step.',
  '',
  '_Sources: Doc A_',
].join('\n');

describe('framework criteria', () => {
  describe('min_use_cases', () => {
    it('passes with 3+ numbered use cases', () => {
      const r = check('min_use_cases', GOOD_FRAMEWORK);
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(3);
    });

    it('fails with fewer than 3 use cases', () => {
      const r = check('min_use_cases', MINIMAL_FRAMEWORK_MISSING_USE_CASES);
      expect(r.passed).toBe(false);
      expect(r.detail.actual).toBe(1);
      expect(r.detail.expected).toBe(MIN_USE_CASES);
    });

    it('fails when no use cases section exists', () => {
      const r = check('min_use_cases', '## Executive summary\nSome text.');
      expect(r.passed).toBe(false);
      expect(r.detail.actual).toBe(0);
    });

    it('counts use cases under German heading', () => {
      const de = [
        '## Priorisierte Use Cases',
        '1. Erster Anwendungsfall',
        '2. Zweiter Anwendungsfall',
        '3. Dritter Anwendungsfall',
        '4. Vierter Anwendungsfall',
      ].join('\n');
      const r = check('min_use_cases', de);
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(4);
    });
  });

  describe('has_executive_summary', () => {
    it('passes when executive summary heading exists', () => {
      const r = check('has_executive_summary', GOOD_FRAMEWORK);
      expect(r.passed).toBe(true);
    });

    it('passes with German capitalization', () => {
      const r = check('has_executive_summary', '## Executive Summary\nText');
      expect(r.passed).toBe(true);
    });

    it('fails when heading is missing', () => {
      const r = check('has_executive_summary', '## Situation\nText only');
      expect(r.passed).toBe(false);
    });
  });

  describe('has_all_sections', () => {
    it('passes when all 6 sections are present (EN)', () => {
      const r = check('has_all_sections', GOOD_FRAMEWORK);
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(6);
    });

    it('passes with German section headings', () => {
      const de = [
        '## Executive Summary',
        '## Ausgangslage',
        '## Kernthemen & Ziele',
        '## Rahmenbedingungen',
        '## Priorisierte Use Cases',
        '## Nächste Schritte',
      ].join('\n');
      const r = check('has_all_sections', de);
      expect(r.passed).toBe(true);
    });

    it('fails when sections are missing', () => {
      const r = check('has_all_sections', '## Executive summary\n## Situation');
      expect(r.passed).toBe(false);
      expect(r.detail.actual).toBe(2);
    });
  });

  describe('has_sources', () => {
    it('passes with English sources line', () => {
      const r = check('has_sources', GOOD_FRAMEWORK);
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(2);
    });

    it('passes with German Quellen line', () => {
      const r = check('has_sources', 'Content\n\n_Quellen: Dok A, Dok B, Dok C_');
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(3);
    });

    it('fails when no sources line exists', () => {
      const r = check('has_sources', '## Executive summary\nText without sources');
      expect(r.passed).toBe(false);
      expect(r.detail.actual).toBe(0);
    });

    it('fails when sources line is empty', () => {
      const r = check('has_sources', 'Text\nSources: ');
      expect(r.passed).toBe(false);
    });
  });

  describe('min_length', () => {
    it('passes with sufficient content', () => {
      // Sanity: the good framework has well over 500 non-whitespace chars.
      const nonWs = GOOD_FRAMEWORK.replace(/\s/g, '').length;
      expect(nonWs).toBeGreaterThanOrEqual(MIN_LENGTH_CHARS);
      const r = check('min_length', GOOD_FRAMEWORK);
      expect(r.detail.actual).toBe(nonWs);
      expect(r.passed).toBe(true);
    });

    it('fails with too little content', () => {
      const r = check('min_length', 'Short.');
      expect(r.passed).toBe(false);
      expect(r.detail.expected).toBe(MIN_LENGTH_CHARS);
    });

    it('counts non-whitespace characters', () => {
      const long = 'x'.repeat(MIN_LENGTH_CHARS);
      const r = check('min_length', long);
      expect(r.passed).toBe(true);
    });

    it('ignores whitespace in count', () => {
      const spacey = ('x '.repeat(MIN_LENGTH_CHARS) + 'x').trim();
      const r = check('min_length', spacey);
      expect(r.passed).toBe(true);
      expect(r.detail.actual).toBe(MIN_LENGTH_CHARS + 1);
    });
  });

  describe('null content', () => {
    it('all criteria handle null content gracefully', () => {
      const nullObs: Observation = {
        sourceKey: 'deliverable',
        externalRef: 'test',
        type: 'framework',
        content: null,
        metadata: {},
        createdAt: new Date(),
      };
      for (const criterion of frameworkCriteria.criteria) {
        const result = criterion.check(nullObs);
        expect(result.passed).toBe(false);
        expect(result.key).toBe(criterion.key);
      }
    });
  });
});
