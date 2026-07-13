// Structural checks for P1-C (skills catalog + flash) and seed bridge docs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSkills } from '../src/lib/skills';

const root = join(import.meta.dirname, '..');

describe('P1-C skills catalog + feedback wiring', () => {
  it('catalog includes second generative skill', () => {
    const keys = listSkills().map((s) => s.key);
    expect(keys).toContain('transkript_zu_use_cases');
    expect(keys).toContain('transkript_zu_framework');
  });

  it('skills page uses catalog-then-start (details) and flash banner', () => {
    const page = readFileSync(join(root, 'src/app/dashboard/skills/page.tsx'), 'utf8');
    expect(page).toMatch(/<details/);
    expect(page).toMatch(/openForm|FlashBanner/);
    expect(page).toMatch(/transkript_zu_use_cases/);
    expect(page).toMatch(/descriptions/);
  });

  it('flash component is client-driven by ?flash=', () => {
    const flash = readFileSync(join(root, 'src/app/dashboard/flash.tsx'), 'utf8');
    expect(flash).toMatch(/useSearchParams/);
    expect(flash).toMatch(/flash/);
  });
});

describe('P1-D demo seed + runbook', () => {
  it('seed-demo imports resolveDemoOrgIds', () => {
    const seed = readFileSync(join(root, 'scripts/seed-demo.ts'), 'utf8');
    expect(seed).toMatch(/resolveDemoOrgIds/);
    expect(seed).toMatch(/DEMO_CLERK_ORG/);
  });

  it('runbook documents env one-command path', () => {
    const rb = readFileSync(join(root, 'docs/yc-demo-runbook.md'), 'utf8');
    expect(rb).toMatch(/DEMO_CLERK_ORG_ID/);
    expect(rb).toMatch(/pnpm seed:demo/);
  });
});
