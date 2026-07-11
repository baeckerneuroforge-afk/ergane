import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import {
  createClient,
  getClient,
  getClientActivity,
  listClients,
  updateClient,
} from '../src/lib/clients';
import { startRun } from '../src/lib/skills';

const ORG_A = 'ca000000-ca00-4a00-8a00-ca0000000001';
const ORG_B = 'ca000000-ca00-4a00-8a00-ca0000000002';
const ADMIN_A = 'client_admin_a';
const MEMBER_A = 'client_member_a';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'clients',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
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
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_client_a', name: 'Org A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: ADMIN_A, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER_A, role: 'member' } });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_client_b', name: 'Org B' } });
    await tx.membership.create({ data: { orgId: ORG_B, userId: 'admin_b', role: 'admin' } });
  });
});

describe('client CRUD', () => {
  it('admin creates a client with name and notes; audit entry written', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: '  Acme Corp  ',
      notes: 'Main contact: Jane',
    });
    expect(client.name).toBe('Acme Corp');
    expect(client.notes).toBe('Main contact: Jane');
    expect(client.orgId).toBe(ORG_A);

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'client.created' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.target).toBe(`client:${client.id}`);
  });

  it('admin updates a client name; audit carries old and new', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Old Name',
    });
    const updated = await updateClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      clientId: client.id,
      name: 'New Name',
    });
    expect(updated.name).toBe('New Name');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'client.updated' } }),
    );
    expect(audit).toHaveLength(1);
    const detail = audit[0]!.detail as Record<string, unknown>;
    expect(detail).toMatchObject({
      old: { name: 'Old Name' },
      new: { name: 'New Name' },
    });
  });

  it('listClients returns clients sorted by name', async () => {
    await createClient({ orgId: ORG_A, actorUserId: ADMIN_A, name: 'Zulu Corp' });
    await createClient({ orgId: ORG_A, actorUserId: ADMIN_A, name: 'Alpha Inc' });

    const list = await listClients(ORG_A);
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('Alpha Inc');
    expect(list[1]!.name).toBe('Zulu Corp');
  });

  it('getClient returns null for nonexistent id', async () => {
    const result = await getClient(ORG_A, '00000000-0000-4000-8000-000000000099');
    expect(result).toBeNull();
  });

  it('empty name is rejected', async () => {
    await expect(
      createClient({ orgId: ORG_A, actorUserId: ADMIN_A, name: '   ' }),
    ).rejects.toThrow(/must not be empty/);
  });

  it('name over 200 chars is rejected', async () => {
    await expect(
      createClient({ orgId: ORG_A, actorUserId: ADMIN_A, name: 'X'.repeat(201) }),
    ).rejects.toThrow(/at most 200/);
  });
});

describe('admin gate', () => {
  it('member is refused when creating a client', async () => {
    await expect(
      createClient({ orgId: ORG_A, actorUserId: MEMBER_A, name: 'Nope Corp' }),
    ).rejects.toThrow(/admin required/);

    const list = await listClients(ORG_A);
    expect(list).toHaveLength(0);
  });

  it('member is refused when updating a client', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Created by admin',
    });
    await expect(
      updateClient({
        orgId: ORG_A,
        actorUserId: MEMBER_A,
        clientId: client.id,
        name: 'Hacked',
      }),
    ).rejects.toThrow(/admin required/);

    const unchanged = await getClient(ORG_A, client.id);
    expect(unchanged!.name).toBe('Created by admin');
  });
});

describe('tenant isolation', () => {
  it('client of Org A is invisible to Org B (RLS)', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'A-only client',
    });

    const fromB = await getClient(ORG_B, client.id);
    expect(fromB).toBeNull();

    const listB = await listClients(ORG_B);
    expect(listB).toHaveLength(0);
  });

  it('querying clients without tenant context returns zero rows', async () => {
    await createClient({ orgId: ORG_A, actorUserId: ADMIN_A, name: 'Test' });
    const bare = await prisma.client.findMany();
    expect(bare).toHaveLength(0);
  });
});

describe('skill run + clientId', () => {
  it('a run can be linked to a client via clientId', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Linked Client',
    });

    const handle = await startRun(ORG_A, 'wissen_zusammenfassen', { frage: 'test?' }, {
      clientId: client.id,
    });

    const run = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUnique({ where: { id: handle.runId } }),
    );
    expect(run!.clientId).toBe(client.id);

    // Client hub activity sees the linked run (tracker surface).
    const activity = await getClientActivity(ORG_A, client.id);
    expect(activity).not.toBeNull();
    expect(activity!.runCount).toBe(1);
    expect(activity!.recentRuns.map((r) => r.id)).toContain(handle.runId);
  });

  it('a run without clientId works unchanged (null)', async () => {
    const handle = await startRun(ORG_A, 'wissen_zusammenfassen', { frage: 'test?' });

    const run = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUnique({ where: { id: handle.runId } }),
    );
    expect(run!.clientId).toBeNull();
  });

  it('rejects linking a foreign-tenant clientId (FK / isolation)', async () => {
    const bClient = await createClient({
      orgId: ORG_B,
      actorUserId: 'admin_b',
      name: 'B Client',
    });
    await expect(
      startRun(ORG_A, 'wissen_zusammenfassen', { frage: 'x' }, { clientId: bClient.id }),
    ).rejects.toThrow();
  });
});
