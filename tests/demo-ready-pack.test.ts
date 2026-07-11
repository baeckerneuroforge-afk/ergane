// =============================================================================
// YC DEMO-READY PACK
//
//   1. isUsingFakeAiProviders pure helper
//   2. isDemoOrg allowlist includes nordwind seed clerk id
//   3. UI wiring: demo guidance gated, fake banner in layout
//   4. Legal: no LegalPlaceholder firm marks on primary legal pages
//   5. Runbook + seed script client link
// =============================================================================
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUsingFakeAiProviders } from '../src/lib/ai';
import {
  demoAllowlist,
  isDemoOrg,
  NORDWIND_DEMO_CLERK_ORG_ID,
} from '../src/lib/demo/isolation';

const root = join(import.meta.dirname, '..');

afterEach(() => {
  // helpers are pure / env-injected; nothing to reset
});

describe('isUsingFakeAiProviders', () => {
  it('true when either key missing; false when both set', () => {
    expect(isUsingFakeAiProviders({})).toBe(true);
    expect(isUsingFakeAiProviders({ ANTHROPIC_API_KEY: 'x' })).toBe(true);
    expect(isUsingFakeAiProviders({ VOYAGE_API_KEY: 'y' })).toBe(true);
    expect(
      isUsingFakeAiProviders({
        ANTHROPIC_API_KEY: 'x',
        VOYAGE_API_KEY: 'y',
      }),
    ).toBe(false);
  });
});

describe('demo org allowlist', () => {
  it('includes nordwind seed clerk id and nordwind slug', () => {
    const list = demoAllowlist('');
    expect(list.has(NORDWIND_DEMO_CLERK_ORG_ID)).toBe(true);
    expect(list.has('nordwind')).toBe(true);
    expect(list.has('demo')).toBe(true);
    expect(isDemoOrg({ clerkOrgId: NORDWIND_DEMO_CLERK_ORG_ID, orgSlug: null })).toBe(true);
    expect(isDemoOrg({ clerkOrgId: 'org_customer', orgSlug: 'acme' })).toBe(false);
    expect(isDemoOrg({ clerkOrgId: 'org_x', orgSlug: 'nordwind' })).toBe(true);
  });
});

describe('UI wiring', () => {
  it('dashboard cockpit renders DemoGuidanceCard only behind isDemoOrg', () => {
    const page = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(page).toMatch(/isDemoOrg/);
    expect(page).toMatch(/DemoGuidanceCard/);
    expect(page).toMatch(/showDemoGuidance/);
  });

  it('dashboard layout shows FakeAiBanner when fakes active', () => {
    const layout = readFileSync(join(root, 'src/app/dashboard/layout.tsx'), 'utf8');
    expect(layout).toMatch(/isUsingFakeAiProviders/);
    expect(layout).toMatch(/FakeAiBanner/);
  });
});

describe('legal soften', () => {
  it('public shell and marketing footer do not push imprint as primary nav', () => {
    const shell = readFileSync(join(root, 'src/app/public-shell.tsx'), 'utf8');
    const footer = readFileSync(join(root, 'src/components/marketing/site.tsx'), 'utf8');
    // Primary chrome: pilot contact, not /imprint links
    expect(shell).toMatch(/pilot@helix\.ai/);
    expect(shell).not.toMatch(/href=\{legal\.imprint\}/);
    expect(footer).toMatch(/\/pilot/);
    expect(footer).not.toMatch(/href: "\/imprint"/);
  });

  it('imprint/impressum pages have no LegalPlaceholder marks', () => {
    for (const rel of [
      'src/app/imprint/page.tsx',
      'src/app/impressum/page.tsx',
      'src/app/privacy/page.tsx',
      'src/app/datenschutz/page.tsx',
      'src/app/dpa/page.tsx',
      'src/app/avv/page.tsx',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/LegalPlaceholder/);
      expect(src, rel).not.toMatch(/<P>/);
    }
  });
});

describe('runbook + seed client', () => {
  it('docs/yc-demo-runbook.md exists with path and fallbacks', () => {
    const rb = readFileSync(join(root, 'docs/yc-demo-runbook.md'), 'utf8');
    expect(rb).toMatch(/\/dashboard\/knowledge/);
    expect(rb).toMatch(/\/demo\/isolation/);
    expect(rb).toMatch(/Fallback|fallback|Offline/i);
    expect(rb).toMatch(/Hanse Logistik|seed:demo/);
  });

  it('seed-demo creates client and links startRun with clientId', () => {
    const seed = readFileSync(join(root, 'scripts/seed-demo.ts'), 'utf8');
    expect(seed).toMatch(/createClient/);
    expect(seed).toMatch(/Hanse Logistik/);
    expect(seed).toMatch(/clientId:\s*demoClient\.id/);
  });
});
