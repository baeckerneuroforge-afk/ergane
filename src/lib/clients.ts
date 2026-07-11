import type { Client, Role } from '@prisma/client';
import { logAudit } from './audit';
import { getMemberRole } from './policies';
import { withTenant, type Tx } from './tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

const NAME_MAX = 200;
const NOTES_MAX = 2000;

function requireAdminRole(role: Role | null, actorUserId: string): void {
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `clients: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not manage clients — admin required.`,
    );
  }
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('Client name must not be empty.');
  if (name.length > NAME_MAX) {
    throw new Error(`Client name must be at most ${NAME_MAX} characters.`);
  }
  return name;
}

function normalizeNotes(raw: string | null | undefined): string | null {
  const notes = raw?.trim() ?? '';
  if (notes === '') return null;
  if (notes.length > NOTES_MAX) {
    throw new Error(`Client notes must be at most ${NOTES_MAX} characters.`);
  }
  return notes;
}

export interface CreateClientInput {
  orgId: string;
  actorUserId: string;
  name: string;
  notes?: string | null;
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const name = normalizeName(input.name);
  const notes = normalizeNotes(input.notes);

  return withTenant(input.orgId, async (tx) => {
    const role = await getMemberRole(tx, input.actorUserId);
    requireAdminRole(role, input.actorUserId);

    const client = await tx.client.create({
      data: { orgId: input.orgId, name, notes },
    });

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'client.created',
      target: `client:${client.id}`,
      detail: { name, notes },
    });

    return client;
  });
}

export interface UpdateClientInput {
  orgId: string;
  actorUserId: string;
  clientId: string;
  name?: string;
  notes?: string | null;
}

export async function updateClient(input: UpdateClientInput): Promise<Client> {
  const name = input.name !== undefined ? normalizeName(input.name) : undefined;
  const notes = input.notes !== undefined ? normalizeNotes(input.notes) : undefined;

  if (name === undefined && notes === undefined) {
    throw new Error('updateClient: at least one field (name or notes) must be provided.');
  }

  return withTenant(input.orgId, async (tx) => {
    const role = await getMemberRole(tx, input.actorUserId);
    requireAdminRole(role, input.actorUserId);

    const old = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!old) throw new Error('Client not found.');

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (notes !== undefined) data.notes = notes;

    const updated = await tx.client.update({
      where: { id: input.clientId },
      data,
    });

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'client.updated',
      target: `client:${updated.id}`,
      detail: {
        old: { name: old.name, notes: old.notes },
        new: { name: updated.name, notes: updated.notes },
      },
    });

    return updated;
  });
}

export async function listClients(orgId: string): Promise<Client[]> {
  return withTenant(orgId, (tx) =>
    tx.client.findMany({ orderBy: { name: 'asc' } }),
  );
}

export async function getClient(orgId: string, clientId: string): Promise<Client | null> {
  return withTenant(orgId, (tx) =>
    tx.client.findUnique({ where: { id: clientId } }),
  );
}

export interface DeleteClientInput {
  orgId: string;
  actorUserId: string;
  clientId: string;
}

/**
 * Admin-only client erase (PII in notes). skill_runs / artifacts that referenced
 * this client get client_id SET NULL (schema FK). Tenant-scoped via RLS.
 */
export async function deleteClient(input: DeleteClientInput): Promise<{ id: string; name: string }> {
  return withTenant(input.orgId, async (tx) => {
    const role = await getMemberRole(tx, input.actorUserId);
    requireAdminRole(role, input.actorUserId);

    const existing = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!existing) {
      throw new Error('Client not found.');
    }

    await tx.client.delete({ where: { id: input.clientId } });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'client.deleted',
      target: `client:${existing.id}`,
      // Do not echo notes (PII) into the audit trail on erase.
      detail: { name: existing.name },
    });

    return { id: existing.id, name: existing.name };
  });
}

export async function listClientsInTx(tx: Tx): Promise<Pick<Client, 'id' | 'name'>[]> {
  return tx.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/** Hub-style summary for one client: linked runs + counts (tenant-scoped). */
export async function getClientActivity(
  orgId: string,
  clientId: string,
): Promise<{
  client: Client;
  runCount: number;
  artifactCount: number;
  recentRuns: Array<{ id: string; skillKey: string; status: string; createdAt: Date }>;
} | null> {
  return withTenant(orgId, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) return null;
    const [runCount, artifactCount, recentRuns] = await Promise.all([
      tx.skillRun.count({ where: { clientId } }),
      tx.artifact.count({ where: { clientId } }),
      tx.skillRun.findMany({
        where: { clientId },
        select: { id: true, skillKey: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { client, runCount, artifactCount, recentRuns };
  });
}
