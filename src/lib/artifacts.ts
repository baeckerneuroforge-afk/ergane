import type { Artifact, Role } from '@prisma/client';
import { logAudit } from './audit';
import { getMemberRole } from './policies';
import { getBlobProvider } from './storage/blob';
import { withTenant, type Tx } from './tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

function requireAdminRole(role: Role | null, actorUserId: string): void {
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `artifacts: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not manage artifacts — admin required.`,
    );
  }
}

function buildSlug(clientId: string | null, type: string, title: string): string {
  const parts = [clientId ?? '_', type, title.toLowerCase().slice(0, 100)];
  return parts.join('/');
}

export interface CreateArtifactInput {
  orgId: string;
  title: string;
  type: string;
  clientId?: string | null;
  runId?: string | null;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Store a new artifact: blob-put OUTSIDE any tenant transaction (network call),
 * then artifact row + audit atomically in a short withTenant transaction.
 *
 * If the DB write fails after a successful blob-put, the blob becomes orphaned.
 * This is the documented, tolerated failure mode: orphaned blobs can be cleaned
 * up later (garbage-collect blobs without a matching artifact row). The inverse
 * (DB row without a blob) never happens because we write blob first.
 */
export async function createArtifact(input: CreateArtifactInput): Promise<Artifact> {
  const { orgId, title, type, bytes, contentType } = input;
  const clientId = input.clientId ?? null;
  const runId = input.runId ?? null;
  const slug = buildSlug(clientId, type, title);

  const blob = getBlobProvider();
  const key = `artifacts/${orgId}/${crypto.randomUUID()}`;
  const ref = await blob.put(key, bytes, contentType);

  try {
    return await withTenant(orgId, async (tx) => {
      const maxVersion = await tx.artifact.findFirst({
        where: { orgId, slug },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (maxVersion?.version ?? 0) + 1;

      const artifact = await tx.artifact.create({
        data: {
          orgId,
          title,
          type,
          clientId,
          runId,
          blobKey: ref.key,
          contentType: ref.contentType,
          sizeBytes: ref.size,
          version,
          slug,
        },
      });

      await logAudit(tx, {
        orgId,
        actorId: 'skill-engine',
        actorType: 'agent',
        action: 'artifact.created',
        target: `artifact:${artifact.id}`,
        detail: { title, type, version, clientId, runId, sizeBytes: ref.size },
      });

      return artifact;
    });
  } catch (err) {
    try {
      await blob.delete(key);
    } catch {
      // Best-effort cleanup of orphaned blob; logged but not rethrown.
    }
    throw err;
  }
}

export async function listArtifacts(orgId: string, clientId?: string | null): Promise<Artifact[]> {
  return withTenant(orgId, (tx) =>
    tx.artifact.findMany({
      where: clientId ? { clientId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getArtifact(orgId: string, artifactId: string): Promise<Artifact | null> {
  return withTenant(orgId, (tx) =>
    tx.artifact.findUnique({ where: { id: artifactId } }),
  );
}

export async function getArtifactVersions(orgId: string, slug: string): Promise<Artifact[]> {
  return withTenant(orgId, (tx) =>
    tx.artifact.findMany({
      where: { slug },
      orderBy: { version: 'desc' },
    }),
  );
}

export async function getArtifactContent(orgId: string, artifactId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const artifact = await getArtifact(orgId, artifactId);
  if (!artifact) return null;
  const blob = getBlobProvider();
  return blob.get(artifact.blobKey);
}

export interface DeleteArtifactInput {
  orgId: string;
  actorUserId: string;
  artifactId: string;
}

export async function deleteArtifact(input: DeleteArtifactInput): Promise<void> {
  const { orgId, actorUserId, artifactId } = input;

  const artifact = await withTenant(orgId, async (tx) => {
    const role = await getMemberRole(tx, actorUserId);
    requireAdminRole(role, actorUserId);
    return tx.artifact.findUnique({ where: { id: artifactId } });
  });

  if (!artifact) throw new Error('Artifact not found.');

  const blob = getBlobProvider();
  await blob.delete(artifact.blobKey);

  await withTenant(orgId, async (tx) => {
    await tx.artifact.delete({ where: { id: artifactId } });
    await logAudit(tx, {
      orgId,
      actorId: actorUserId,
      actorType: 'human',
      action: 'artifact.deleted',
      target: `artifact:${artifactId}`,
      detail: { title: artifact.title, type: artifact.type, version: artifact.version },
    });
  });
}

export async function listArtifactsInTx(tx: Tx): Promise<Pick<Artifact, 'id' | 'title' | 'type' | 'version' | 'clientId' | 'createdAt' | 'sizeBytes' | 'contentType'>[]> {
  return tx.artifact.findMany({
    select: { id: true, title: true, type: true, version: true, clientId: true, createdAt: true, sizeBytes: true, contentType: true },
    orderBy: { createdAt: 'desc' },
  });
}
