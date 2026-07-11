// =============================================================================
// BOUNDS GATE — knowledge list page cap + export fail-closed size guard.
//
//   1. Knowledge page hard-caps findMany with take: KNOWLEDGE_PAGE_LIMIT.
//   2. exportOrgData refuses when any table exceeds the export row limit
//      (fail-closed, no silent truncation) — driven through the real function.
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  EXPORT_MAX_ROWS_PER_TABLE,
  __setExportMaxRowsPerTableForTests,
  exportOrgData,
} from '../src/lib/lifecycle';
import { KNOWLEDGE_PAGE_LIMIT } from '../src/app/dashboard/knowledge/limits';

const ORG = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const ADMIN = 'bounds_admin';
const MEMBER = 'bounds_member';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
  'org_settings', 'chat_feedback',
];

const owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await owner.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await owner.$disconnect();
});

beforeEach(async () => {
  await reset();
  __setExportMaxRowsPerTableForTests(null);
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({
      data: { id: ORG, clerkOrgId: 'org_bounds', name: 'Bounds Org' },
    });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG, userId: MEMBER, role: 'member' } });
  });
});

afterEach(() => {
  __setExportMaxRowsPerTableForTests(null);
});

describe('knowledge page list bound', () => {
  it('exports a finite KNOWLEDGE_PAGE_LIMIT and the page query uses take', () => {
    expect(KNOWLEDGE_PAGE_LIMIT).toBeGreaterThan(0);
    expect(KNOWLEDGE_PAGE_LIMIT).toBeLessThanOrEqual(500);

    const pageSrc = readFileSync(
      join(import.meta.dirname, '../src/app/dashboard/knowledge/page.tsx'),
      'utf8',
    );
    const limitsSrc = readFileSync(
      join(import.meta.dirname, '../src/app/dashboard/knowledge/limits.ts'),
      'utf8',
    );
    expect(limitsSrc).toMatch(/KNOWLEDGE_PAGE_LIMIT\s*=\s*100/);
    expect(pageSrc).toMatch(/take:\s*KNOWLEDGE_PAGE_LIMIT/);
    expect(pageSrc).toMatch(/orderBy:\s*\{\s*createdAt:\s*'desc'/);
  });

  it('findMany with take returns at most the page limit when more docs exist', async () => {
    const n = 5;
    await withTenant(ORG, async (tx) => {
      for (let i = 0; i < n; i++) {
        await tx.document.create({
          data: {
            orgId: ORG,
            title: `Doc ${i}`,
            source: 'manual',
            visibility: 'open',
          },
        });
      }
    });
    const take = 3;
    const page = await withTenant(ORG, (tx) =>
      tx.document.findMany({
        orderBy: { createdAt: 'desc' },
        take,
      }),
    );
    expect(page).toHaveLength(take);
    const total = await withTenant(ORG, (tx) => tx.document.count());
    expect(total).toBe(n);
  });
});

describe('exportOrgData size guard', () => {
  it('exports a finite EXPORT_MAX_ROWS_PER_TABLE constant', () => {
    expect(EXPORT_MAX_ROWS_PER_TABLE).toBeGreaterThan(0);
    expect(EXPORT_MAX_ROWS_PER_TABLE).toBeLessThanOrEqual(100_000);
  });

  it('lifecycle export source counts before loading each table', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../src/lib/lifecycle/index.ts'),
      'utf8',
    );
    expect(src).toMatch(/EXPORT_MAX_ROWS_PER_TABLE/);
    expect(src).toMatch(/assertExportTableWithinBound/);
    expect(src).toMatch(/membership\.count/);
    expect(src).toMatch(/document\.count/);
    expect(src).toMatch(/auditLog\.count/);
  });

  it('exportOrgData succeeds under the bound and is audited', async () => {
    await withTenant(ORG, async (tx) => {
      await tx.document.create({
        data: { orgId: ORG, title: 'One', source: 'manual', visibility: 'open' },
      });
    });
    const data = await exportOrgData({ orgId: ORG, actorUserId: ADMIN });
    expect(data.orgId).toBe(ORG);
    expect((data.documents as unknown[]).length).toBe(1);

    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: 'org.exported' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('exportOrgData fails closed when a table exceeds the safety bound', async () => {
    // 2 memberships already seeded. Bound of 1 → count > limit → refuse.
    __setExportMaxRowsPerTableForTests(1);
    await expect(exportOrgData({ orgId: ORG, actorUserId: ADMIN })).rejects.toThrow(
      /Export refused|limit 1|has 2 rows/i,
    );
    // No successful export audit on failure.
    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: 'org.exported' } }),
    );
    expect(audit).toHaveLength(0);
  });
});
