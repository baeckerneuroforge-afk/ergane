// =============================================================================
// GDPR: clients + artifacts export, tenant blob erase, client delete
//
//   1. exportOrgData includes clients + artifact metadata (own tenant only).
//   2. deleteOrganization deletes artifact blobs via BlobProvider before cascade.
//   3. deleteClient removes PII notes under admin gate; isolation holds.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { createArtifact } from '../src/lib/artifacts';
import { createClient, deleteClient, getClient } from '../src/lib/clients';
import { deleteOrganization, exportOrgData } from '../src/lib/lifecycle';
import { getFakeBlobProvider } from '../src/lib/storage/blob';

const ORG_A = 'ad000000-ad00-4d00-8d00-ad0000000001';
const ORG_B = 'ad000000-ad00-4d00-8d00-ad0000000002';
const ADMIN_A = 'gdpr_admin_a';
const MEMBER_A = 'gdpr_member_a';
const ADMIN_B = 'gdpr_admin_b';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
  'org_settings', 'chat_feedback', 'clients', 'artifacts',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fakeBlob = getFakeBlobProvider();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  fakeBlob.reset();
}

async function seed() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({
      data: { id: ORG_A, clerkOrgId: 'org_gdpr_a', name: 'GDPR Org A' },
    });
    await tx.membership.create({ data: { orgId: ORG_A, userId: ADMIN_A, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER_A, role: 'member' } });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({
      data: { id: ORG_B, clerkOrgId: 'org_gdpr_b', name: 'GDPR Org B' },
    });
    await tx.membership.create({ data: { orgId: ORG_B, userId: ADMIN_B, role: 'admin' } });
  });
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
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await seed();
});

describe('exportOrgData includes clients + artifacts', () => {
  it('exports own-tenant client notes and artifact metadata; never org B', async () => {
    const clientA = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Acme North',
      notes: 'PII-contact-alice@example.com',
    });
    await createClient({
      orgId: ORG_B,
      actorUserId: ADMIN_B,
      name: 'Beta South',
      notes: 'secret-of-B',
    });

    const bytes = new TextEncoder().encode('# Framework A\ncontent-a');
    const artA = await createArtifact({
      orgId: ORG_A,
      title: 'Framework North',
      type: 'framework',
      clientId: clientA.id,
      bytes,
      contentType: 'text/markdown',
    });
    await createArtifact({
      orgId: ORG_B,
      title: 'Framework South',
      type: 'framework',
      bytes: new TextEncoder().encode('B-only'),
      contentType: 'text/markdown',
    });

    const data = await exportOrgData({ orgId: ORG_A, actorUserId: ADMIN_A });
    expect(data.orgId).toBe(ORG_A);

    const clients = data.clients as Array<{ id: string; name: string; notes: string | null }>;
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe('Acme North');
    expect(clients[0]!.notes).toContain('alice@example.com');

    const artifacts = data.artifacts as Array<{
      id: string;
      title: string;
      blobKey: string;
      sizeBytes: number;
      type: string;
    }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.id).toBe(artA.id);
    expect(artifacts[0]!.title).toBe('Framework North');
    expect(artifacts[0]!.blobKey).toBe(artA.blobKey);
    expect(artifacts[0]!.sizeBytes).toBe(bytes.length);
    // No raw binary payload in export.
    expect(JSON.stringify(artifacts[0])).not.toMatch(/Framework A\\ncontent/);

    const json = JSON.stringify(data);
    expect(json).not.toContain('Beta South');
    expect(json).not.toContain('secret-of-B');
    expect(json).not.toContain('Framework South');
  });

  it('rejects non-admin export', async () => {
    await expect(
      exportOrgData({ orgId: ORG_A, actorUserId: MEMBER_A }),
    ).rejects.toThrow(/admin required/);
  });
});

describe('deleteOrganization clears artifact blobs', () => {
  it('invokes blob delete for tenant artifact keys; store no longer holds them', async () => {
    const art = await createArtifact({
      orgId: ORG_A,
      title: 'To erase',
      type: 'framework',
      bytes: new TextEncoder().encode('erase-me'),
      contentType: 'text/markdown',
    });
    const keyA = art.blobKey;
    expect(fakeBlob.store.has(keyA)).toBe(true);

    // B keeps its blob.
    const artB = await createArtifact({
      orgId: ORG_B,
      title: 'Keep B',
      type: 'framework',
      bytes: new TextEncoder().encode('keep-b'),
      contentType: 'text/markdown',
    });
    expect(fakeBlob.store.has(artB.blobKey)).toBe(true);

    const proof = await deleteOrganization({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      confirmName: 'GDPR Org A',
    });
    expect(proof.counts.artifacts).toBe(1);
    expect(proof.counts.blobsDeleted).toBe(1);
    expect(fakeBlob.store.has(keyA)).toBe(false);
    expect(fakeBlob.store.has(artB.blobKey)).toBe(true);

    // Org A gone; B remains.
    const aOrgs = await admin.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM organizations WHERE id = ${ORG_A}::uuid
    `;
    expect(Number(aOrgs[0]!.n)).toBe(0);
    const bStill = await withTenant(ORG_B, (tx) => tx.organization.count());
    expect(bStill).toBe(1);
  });
});

describe('deleteClient (admin PII erase)', () => {
  it('admin deletes client and notes; member cannot; B unaffected', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Erase Me',
      notes: 'personal-phone-555',
    });
    const other = await createClient({
      orgId: ORG_B,
      actorUserId: ADMIN_B,
      name: 'Stay B',
      notes: 'b-notes',
    });

    await expect(
      deleteClient({ orgId: ORG_A, actorUserId: MEMBER_A, clientId: client.id }),
    ).rejects.toThrow(/admin required/);

    const result = await deleteClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      clientId: client.id,
    });
    expect(result.name).toBe('Erase Me');
    expect(await getClient(ORG_A, client.id)).toBeNull();

    // Notes must not linger.
    const gone = await withTenant(ORG_A, (tx) => tx.client.findMany());
    expect(gone).toHaveLength(0);

    const bClient = await getClient(ORG_B, other.id);
    expect(bClient?.notes).toBe('b-notes');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'client.deleted' } }),
    );
    expect(audit).toHaveLength(1);
    // Audit must not re-store PII notes.
    expect(JSON.stringify(audit[0]!.detail)).not.toContain('personal-phone');
  });

  it('is tenant-scoped: A cannot delete B client id', async () => {
    const bClient = await createClient({
      orgId: ORG_B,
      actorUserId: ADMIN_B,
      name: 'B only',
    });
    await expect(
      deleteClient({ orgId: ORG_A, actorUserId: ADMIN_A, clientId: bClient.id }),
    ).rejects.toThrow(/not found/i);
    expect(await getClient(ORG_B, bClient.id)).not.toBeNull();
  });
});
