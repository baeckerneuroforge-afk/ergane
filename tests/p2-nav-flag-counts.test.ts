// Skeptic fixes: connectors nav not "soon"; flag badge/cockpit ignore status_changed
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { createLoopFlagInTx, setLoopFlagStatus } from '../src/lib/loop/flags';
import { logAudit } from '../src/lib/audit';

const ORG = 'd9d9d9d9-d9d9-4d9d-8d9d-d9d9d9d9d9d9';
const USER = 'nav_flag_user';
const TABLES = ['organizations', 'memberships', 'audit_log', 'loop_flags'];
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const root = join(import.meta.dirname, '..');

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await reset();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_nav_flags', name: 'Nav Flags' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: USER, role: 'member' } });
  });
});

describe('connectors nav honesty', () => {
  it('shell does not mark connectors as soon/coming-soon', () => {
    const shell = readFileSync(join(root, 'src/app/dashboard/shell.tsx'), 'utf8');
    // The connectors item must not carry soon: true
    const connectorsBlock = shell.slice(
      shell.indexOf("key: 'connectors'"),
      shell.indexOf("key: 'connectors'") + 200,
    );
    expect(connectorsBlock).not.toMatch(/soon:\s*true/);
  });
});

describe('open flag badge count (layout semantics)', () => {
  /**
   * Mirrors layout.tsx: openFlags = loopFlag.count({ status: 'open' }).
   * Raise → ack → resolve must leave open count at 0, not inflate via audit.
   */
  it('ack/resolve do not inflate open loop_flags count', async () => {
    const flag = await withTenant(ORG, (tx) =>
      createLoopFlagInTx(tx, {
        orgId: ORG,
        action: 'flag.criteria_violated',
        target: 'artifact-x',
        category: 'criteria',
      }),
    );

    // Also write a raise audit (as the engine does)
    await withTenant(ORG, (tx) =>
      logAudit(tx, {
        orgId: ORG,
        actorId: 'loop-engine',
        actorType: 'agent',
        action: 'flag.criteria_violated',
        target: 'artifact-x',
        detail: { category: 'criteria' },
      }),
    );

    const openAfterRaise = await withTenant(ORG, (tx) =>
      tx.loopFlag.count({ where: { status: 'open' } }),
    );
    expect(openAfterRaise).toBe(1);

    await setLoopFlagStatus({
      orgId: ORG,
      actorUserId: USER,
      flagId: flag.id,
      status: 'acked',
    });
    await setLoopFlagStatus({
      orgId: ORG,
      actorUserId: USER,
      flagId: flag.id,
      status: 'resolved',
    });

    const openAfterResolve = await withTenant(ORG, (tx) =>
      tx.loopFlag.count({ where: { status: 'open' } }),
    );
    expect(openAfterResolve).toBe(0);

    // Naive startsWith('flag.') would count raise + 2 status_changed = 3
    const naive = await withTenant(ORG, (tx) =>
      tx.auditLog.count({ where: { action: { startsWith: 'flag.' } } }),
    );
    expect(naive).toBeGreaterThanOrEqual(3);

    // Cockpit 7d count (deviation actions only) stays 1
    const deviationCount = await withTenant(ORG, (tx) =>
      tx.auditLog.count({
        where: {
          action: { in: ['flag.criteria_violated', 'flag.metric_deviation'] },
        },
      }),
    );
    expect(deviationCount).toBe(1);
  });
});

describe('source wiring', () => {
  it('layout counts open loop_flags; cockpit uses deviation actions', () => {
    const layout = readFileSync(join(root, 'src/app/dashboard/layout.tsx'), 'utf8');
    expect(layout).toMatch(/loopFlag\.count/);
    expect(layout).toMatch(/status:\s*['"]open['"]/);
    expect(layout).not.toMatch(/startsWith:\s*['"]flag\./);

    const page = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(page).toMatch(/flag\.criteria_violated/);
    expect(page).toMatch(/flag\.metric_deviation/);
    expect(page).not.toMatch(/startsWith:\s*['"]flag\./);
  });
});
