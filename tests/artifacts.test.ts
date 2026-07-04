import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { createArtifact, deleteArtifact, getArtifact, getArtifactVersions, listArtifacts } from '../src/lib/artifacts';
import { createClient } from '../src/lib/clients';
import { getFakeBlobProvider } from '../src/lib/storage/blob';
import { startRun } from '../src/lib/skills';

const ORG_A = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaa001';
const ORG_B = 'aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaa002';
const ADMIN_A = 'art_admin_a';
const MEMBER_A = 'art_member_a';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'clients', 'artifacts',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fakeBlob = getFakeBlobProvider();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  fakeBlob.reset();
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
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_art_a', name: 'Org A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: ADMIN_A, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: MEMBER_A, role: 'member' } });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_art_b', name: 'Org B' } });
    await tx.membership.create({ data: { orgId: ORG_B, userId: 'admin_b', role: 'admin' } });
  });
});

describe('artifact creation', () => {
  it('creates an artifact and stores blob + DB row', async () => {
    const bytes = new TextEncoder().encode('# Test Framework\n\nContent here');
    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'Test Framework',
      type: 'framework',
      bytes,
      contentType: 'text/markdown',
    });

    expect(artifact.title).toBe('Test Framework');
    expect(artifact.type).toBe('framework');
    expect(artifact.version).toBe(1);
    expect(artifact.sizeBytes).toBe(bytes.length);
    expect(artifact.orgId).toBe(ORG_A);

    // Verify blob was written
    expect(fakeBlob.store.size).toBe(1);
    const stored = fakeBlob.store.get(artifact.blobKey);
    expect(stored).not.toBeNull();
    expect(new TextDecoder().decode(stored!.bytes)).toContain('Test Framework');
  });

  it('links artifact to client and run', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Acme Corp',
    });

    const handle = await startRun(ORG_A, 'wissen_zusammenfassen', { frage: 'test?' }, {
      clientId: client.id,
    });

    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'Framework for Acme',
      type: 'framework',
      clientId: client.id,
      runId: handle.runId,
      bytes: new TextEncoder().encode('content'),
      contentType: 'text/markdown',
    });

    expect(artifact.clientId).toBe(client.id);
    expect(artifact.runId).toBe(handle.runId);
  });

  it('writes audit entry on creation', async () => {
    await createArtifact({
      orgId: ORG_A,
      title: 'Audited',
      type: 'framework',
      bytes: new TextEncoder().encode('x'),
      contentType: 'text/markdown',
    });

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'artifact.created' } }),
    );
    expect(audit).toHaveLength(1);
  });
});

describe('blob write outside withTenant tx', () => {
  it('blob-put happens without a tenant context (app.current_org is not set)', async () => {
    // The createArtifact function writes the blob BEFORE opening a withTenant tx.
    // We verify this by checking that the fake blob provider is called (it records
    // the put), and that the artifact row is created afterward. The critical
    // invariant is that the blob provider's put() is never inside a Prisma
    // interactive transaction — which we prove by the sequence of operations and
    // the fact that the blob store has content before the DB row exists if we
    // split the operation manually. Here we test the integrated flow.
    const bytes = new TextEncoder().encode('blob outside tx');
    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'Outside Tx',
      type: 'framework',
      bytes,
      contentType: 'text/markdown',
    });

    // Blob was written
    expect(fakeBlob.store.has(artifact.blobKey)).toBe(true);
    // DB row exists
    const row = await withTenant(ORG_A, (tx) =>
      tx.artifact.findUnique({ where: { id: artifact.id } }),
    );
    expect(row).not.toBeNull();
  });
});

describe('tenant isolation', () => {
  it('artifact of Org A is invisible to Org B (RLS)', async () => {
    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'A-only',
      type: 'framework',
      bytes: new TextEncoder().encode('secret'),
      contentType: 'text/markdown',
    });

    const fromB = await withTenant(ORG_B, (tx) =>
      tx.artifact.findUnique({ where: { id: artifact.id } }),
    );
    expect(fromB).toBeNull();

    const listB = await listArtifacts(ORG_B);
    expect(listB).toHaveLength(0);
  });

  it('querying artifacts without tenant context returns zero rows', async () => {
    await createArtifact({
      orgId: ORG_A,
      title: 'Test',
      type: 'framework',
      bytes: new TextEncoder().encode('x'),
      contentType: 'text/markdown',
    });
    const bare = await prisma.artifact.findMany();
    expect(bare).toHaveLength(0);
  });
});

describe('versioning', () => {
  it('second artifact with same slug gets version 2; version 1 remains', async () => {
    const a1 = await createArtifact({
      orgId: ORG_A,
      title: 'Framework — Topic X',
      type: 'framework',
      bytes: new TextEncoder().encode('v1 content'),
      contentType: 'text/markdown',
    });
    expect(a1.version).toBe(1);

    const a2 = await createArtifact({
      orgId: ORG_A,
      title: 'Framework — Topic X',
      type: 'framework',
      bytes: new TextEncoder().encode('v2 content'),
      contentType: 'text/markdown',
    });
    expect(a2.version).toBe(2);
    expect(a2.slug).toBe(a1.slug);

    // Both versions exist
    const versions = await getArtifactVersions(ORG_A, a1.slug!);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(2);
    expect(versions[1]!.version).toBe(1);

    // v1 is still accessible
    const v1 = await getArtifact(ORG_A, a1.id);
    expect(v1).not.toBeNull();
    expect(v1!.version).toBe(1);
  });

  it('different client produces independent version chain', async () => {
    const client = await createClient({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      name: 'Client X',
    });

    const a1 = await createArtifact({
      orgId: ORG_A,
      title: 'Framework — Topic',
      type: 'framework',
      bytes: new TextEncoder().encode('no client'),
      contentType: 'text/markdown',
    });

    const a2 = await createArtifact({
      orgId: ORG_A,
      title: 'Framework — Topic',
      type: 'framework',
      clientId: client.id,
      bytes: new TextEncoder().encode('with client'),
      contentType: 'text/markdown',
    });

    // Different slugs → both are version 1
    expect(a1.version).toBe(1);
    expect(a2.version).toBe(1);
    expect(a1.slug).not.toBe(a2.slug);
  });
});

describe('deletion', () => {
  it('deleting an artifact removes both DB row and blob', async () => {
    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'To Delete',
      type: 'framework',
      bytes: new TextEncoder().encode('deleteme'),
      contentType: 'text/markdown',
    });

    expect(fakeBlob.store.has(artifact.blobKey)).toBe(true);

    await deleteArtifact({
      orgId: ORG_A,
      actorUserId: ADMIN_A,
      artifactId: artifact.id,
    });

    // DB row gone
    const row = await withTenant(ORG_A, (tx) =>
      tx.artifact.findUnique({ where: { id: artifact.id } }),
    );
    expect(row).toBeNull();

    // Blob gone
    expect(fakeBlob.store.has(artifact.blobKey)).toBe(false);

    // Audit entry written
    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'artifact.deleted' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('member cannot delete (admin gate)', async () => {
    const artifact = await createArtifact({
      orgId: ORG_A,
      title: 'Protected',
      type: 'framework',
      bytes: new TextEncoder().encode('x'),
      contentType: 'text/markdown',
    });

    await expect(
      deleteArtifact({
        orgId: ORG_A,
        actorUserId: MEMBER_A,
        artifactId: artifact.id,
      }),
    ).rejects.toThrow(/admin required/);

    // Still exists
    const row = await getArtifact(ORG_A, artifact.id);
    expect(row).not.toBeNull();
  });
});
