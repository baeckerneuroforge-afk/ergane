// =============================================================================
// CLIENT TRACKER UI wiring (static + association helper)
//
// Proves the shipped surfaces that close the "client tracker" gaps:
//   - skill start always shows client select OR empty-state CTA
//   - runs list/detail select client relation for display
//   - client hub list is bounded and detail uses UUID gate
// =============================================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_DETAIL_ARTIFACTS_LIMIT,
  CLIENT_DETAIL_RUNS_LIMIT,
  CLIENTS_PAGE_LIMIT,
} from '../src/app/dashboard/clients/limits';

const root = join(import.meta.dirname, '..');

describe('skill-start client field', () => {
  it('always renders client select or empty-state CTA to settings', () => {
    const src = readFileSync(join(root, 'src/app/dashboard/skills/page.tsx'), 'utf8');
    expect(src).toMatch(/name="clientId"/);
    expect(src).toMatch(/clientEmptyHint/);
    expect(src).toMatch(/\/dashboard\/settings\?tab=clients/);
    expect(src).toMatch(/listClientsInTx/);
  });
});

describe('runs surface linked client', () => {
  it('runs list selects client relation and links to client hub', () => {
    const list = readFileSync(join(root, 'src/app/dashboard/runs/page.tsx'), 'utf8');
    expect(list).toMatch(/client:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/);
    expect(list).toMatch(/colClient/);
    expect(list).toMatch(/\/dashboard\/clients\/\$\{run\.client\.id\}/);
  });

  it('run detail loads and displays linked client', () => {
    const detail = readFileSync(join(root, 'src/app/dashboard/runs/[id]/page.tsx'), 'utf8');
    expect(detail).toMatch(/run\?\.clientId/);
    expect(detail).toMatch(/tx\.client\.findUnique/);
    expect(detail).toMatch(/\/dashboard\/clients\/\$\{client\.id\}/);
  });
});

describe('client hub bounds', () => {
  it('exports finite list limits used by pages', () => {
    expect(CLIENTS_PAGE_LIMIT).toBeGreaterThan(0);
    expect(CLIENT_DETAIL_RUNS_LIMIT).toBeGreaterThan(0);
    expect(CLIENT_DETAIL_ARTIFACTS_LIMIT).toBeGreaterThan(0);

    const list = readFileSync(join(root, 'src/app/dashboard/clients/page.tsx'), 'utf8');
    const detail = readFileSync(join(root, 'src/app/dashboard/clients/[id]/page.tsx'), 'utf8');
    expect(list).toMatch(/take:\s*CLIENTS_PAGE_LIMIT/);
    expect(list).toMatch(/_count:\s*\{\s*select:\s*\{\s*artifacts:\s*true,\s*skillRuns:\s*true/);
    expect(detail).toMatch(/take:\s*CLIENT_DETAIL_RUNS_LIMIT/);
    expect(detail).toMatch(/take:\s*CLIENT_DETAIL_ARTIFACTS_LIMIT/);
    expect(detail).toMatch(/isUuid\(id\)/);
  });
});
