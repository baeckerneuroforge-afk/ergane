// =============================================================================
// OPS-REST GATE — defer keep-alive, list bounds, UUID mutation gates, limits.
//
//   1. deferWork invokes the installed keep-alive with the pending promise.
//   2. Instrumentation still wires Next after() → setDeferKeepAlive (static).
//   3. Hot list pages use named finite take constants (pending approvals, runs).
//   4. requireUuid rejects junk ids; mutation action sources use it (static).
//   5. Chat/ingest/run product paths still call assertWithinDailyLimit (static
//      + existing limits.test.ts drives the real gate).
// =============================================================================
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deferWork,
  drainDeferredWork,
  setDeferKeepAlive,
} from '../src/lib/slack/defer';
import { isUuid, requireUuid } from '../src/lib/uuid';
import {
  APPROVALS_DECIDED_LIMIT,
  APPROVALS_PENDING_LIMIT,
} from '../src/app/dashboard/approvals/limits';
import { RUNS_PAGE_LIMIT } from '../src/app/dashboard/runs/limits';
import { KNOWLEDGE_PAGE_LIMIT } from '../src/app/dashboard/knowledge/limits';

const root = join(import.meta.dirname, '..');

afterEach(() => {
  setDeferKeepAlive(null);
});

describe('deferWork keep-alive', () => {
  it('invokes the installed keep-alive with the deferred promise and runs the task', async () => {
    const keepAliveCalls: Promise<void>[] = [];
    setDeferKeepAlive((pending) => {
      keepAliveCalls.push(pending);
    });

    let ran = false;
    deferWork(async () => {
      ran = true;
    }, { label: 'ops-rest-test' });

    // Keep-alive is invoked synchronously when deferWork is called.
    expect(keepAliveCalls).toHaveLength(1);
    await drainDeferredWork();
    expect(ran).toBe(true);
    // Keep-alive received the same promise that drains.
    await expect(keepAliveCalls[0]!).resolves.toBeUndefined();
  });

  it('instrumentation.ts installs setDeferKeepAlive via next/server after', () => {
    const src = readFileSync(join(root, 'src/instrumentation.ts'), 'utf8');
    expect(src).toMatch(/setDeferKeepAlive/);
    expect(src).toMatch(/next\/server/);
    expect(src).toMatch(/\bafter\b/);
  });
});

describe('list bounds (named hard caps)', () => {
  it('exports finite page limits', () => {
    expect(APPROVALS_PENDING_LIMIT).toBeGreaterThan(0);
    expect(APPROVALS_PENDING_LIMIT).toBeLessThanOrEqual(500);
    expect(APPROVALS_DECIDED_LIMIT).toBeGreaterThan(0);
    expect(RUNS_PAGE_LIMIT).toBeGreaterThan(0);
    expect(KNOWLEDGE_PAGE_LIMIT).toBeGreaterThan(0);
  });

  it('approvals and runs pages use take: LIMIT constants', () => {
    const approvals = readFileSync(
      join(root, 'src/app/dashboard/approvals/page.tsx'),
      'utf8',
    );
    const runs = readFileSync(join(root, 'src/app/dashboard/runs/page.tsx'), 'utf8');
    expect(approvals).toMatch(/take:\s*APPROVALS_PENDING_LIMIT/);
    expect(approvals).toMatch(/take:\s*APPROVALS_DECIDED_LIMIT/);
    expect(runs).toMatch(/take:\s*RUNS_PAGE_LIMIT/);
  });
});

describe('requireUuid mutation gates', () => {
  it('rejects empty and non-UUID values; accepts a valid UUID', () => {
    expect(() => requireUuid('', 'runId')).toThrow(/required/i);
    expect(() => requireUuid('   ', 'runId')).toThrow(/required/i);
    expect(() => requireUuid('not-a-uuid', 'runId')).toThrow(/Invalid runId/);
    expect(() => requireUuid('1234', 'documentId')).toThrow(/Invalid documentId/);
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(isUuid(id)).toBe(true);
    expect(requireUuid(id, 'runId')).toBe(id);
    expect(requireUuid(`  ${id}  `, 'runId')).toBe(id);
  });

  it('dashboard mutation actions gate entity ids with requireUuid/isUuid', () => {
    const files = [
      'src/app/dashboard/approvals/actions.ts',
      'src/app/dashboard/knowledge/actions.ts',
      'src/app/dashboard/chat/actions.ts',
      'src/app/dashboard/skills/actions.ts',
      'src/app/dashboard/settings/actions.ts',
      'src/app/dashboard/deliverables/actions.ts',
      'src/app/api/artifacts/[id]/download/route.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toMatch(/requireUuid|isUuid/);
    }
  });
});

describe('daily usage limit coverage', () => {
  it('chat, ingest, and skill-run entry points call assertWithinDailyLimit', () => {
    const answer = readFileSync(join(root, 'src/lib/rag/answer.ts'), 'utf8');
    const ingest = readFileSync(join(root, 'src/lib/rag/ingest.ts'), 'utf8');
    const engine = readFileSync(join(root, 'src/lib/skills/engine.ts'), 'utf8');
    expect(answer).toMatch(/assertWithinDailyLimit\(tx,\s*'chat'\)/);
    expect(ingest).toMatch(/assertWithinDailyLimit\(tx,\s*'ingest'\)/);
    expect(engine).toMatch(/assertWithinDailyLimit\(tx,\s*'run'\)/);
  });
});
