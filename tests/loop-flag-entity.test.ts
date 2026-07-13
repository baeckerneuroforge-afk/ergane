// P2-C: loop_flags status transitions + RLS
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  createLoopFlagInTx,
  listLoopFlags,
  setLoopFlagStatus,
} from '../src/lib/loop/flags';

const ORG_A = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const ORG_B = 'c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4';
const USER = 'flag_user';

const TABLES = [
  'organizations',
  'memberships',
  'audit_log',
  'loop_flags',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

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
  for (const [id, clerk] of [
    [ORG_A, 'org_fa'],
    [ORG_B, 'org_fb'],
  ] as const) {
    await withTenant(id, async (tx) => {
      await tx.organization.create({ data: { id, clerkOrgId: clerk, name: clerk } });
      await tx.membership.create({ data: { orgId: id, userId: USER, role: 'member' } });
    });
  }
});

describe('loop_flags lifecycle', () => {
  it('creates open flags and transitions with audit', async () => {
    const flag = await withTenant(ORG_A, (tx) =>
      createLoopFlagInTx(tx, {
        orgId: ORG_A,
        action: 'flag.criteria_violated',
        target: 'artifact-1',
        category: 'criteria',
        detail: { message: 'test' },
      }),
    );
    expect(flag.status).toBe('open');

    const acked = await setLoopFlagStatus({
      orgId: ORG_A,
      actorUserId: USER,
      flagId: flag.id,
      status: 'acked',
    });
    expect(acked.status).toBe('acked');
    expect(acked.ackedBy).toBe(USER);

    const resolved = await setLoopFlagStatus({
      orgId: ORG_A,
      actorUserId: USER,
      flagId: flag.id,
      status: 'resolved',
    });
    expect(resolved.status).toBe('resolved');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'flag.status_changed' } }),
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const detail = audit[0]!.detail as { old: string; new: string };
    expect(detail.old).toBeTruthy();
    expect(detail.new).toBeTruthy();
  });

  it('list filters by status', async () => {
    await withTenant(ORG_A, async (tx) => {
      await createLoopFlagInTx(tx, {
        orgId: ORG_A,
        action: 'flag.metric_deviation',
        target: 'success_rate',
        category: 'metric',
      });
    });
    const open = await listLoopFlags(ORG_A, { status: 'open' });
    expect(open.total).toBe(1);
    const resolved = await listLoopFlags(ORG_A, { status: 'resolved' });
    expect(resolved.total).toBe(0);
  });

  it('RLS: org B cannot see org A flags', async () => {
    await withTenant(ORG_A, (tx) =>
      createLoopFlagInTx(tx, {
        orgId: ORG_A,
        action: 'flag.criteria_violated',
        target: 'secret',
      }),
    );
    const b = await listLoopFlags(ORG_B, { status: 'all' });
    expect(b.total).toBe(0);
    const bare = await prisma.loopFlag.findMany();
    expect(bare).toHaveLength(0);
  });
});
