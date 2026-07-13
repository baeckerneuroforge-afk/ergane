// Admin mutations for connector installs — withTenant, admin gate, audit.
import type { ConnectorInstallation, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logAudit } from '../audit';
import { getMemberRole } from '../policies';
import { withTenant, type Tx } from '../tenant';
import type { ConnectorProvider } from './types';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

async function requireAdmin(tx: Tx, actorUserId: string): Promise<Role> {
  const role = await getMemberRole(tx, actorUserId);
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `connector admin: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not manage connectors — admin required.`,
    );
  }
  return role;
}

export interface UpsertConnectorInstallationInput {
  orgId: string;
  actorUserId: string;
  provider: ConnectorProvider;
  externalId: string;
  /** enc:… or env:… reference — never a raw token. */
  accessTokenRef: string;
  meta?: Record<string, unknown>;
}

export async function upsertConnectorInstallation(
  input: UpsertConnectorInstallationInput,
): Promise<ConnectorInstallation> {
  const externalId = input.externalId.trim();
  const accessTokenRef = input.accessTokenRef.trim();
  if (!externalId) throw new Error('upsertConnectorInstallation: externalId is required.');
  if (!accessTokenRef) throw new Error('upsertConnectorInstallation: accessTokenRef is required.');
  if (!accessTokenRef.startsWith('enc:') && !accessTokenRef.startsWith('env:')) {
    throw new Error(
      'upsertConnectorInstallation: accessTokenRef must be enc:… or env:… — never the raw secret.',
    );
  }

  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const existing = await tx.connectorInstallation.findUnique({
      where: {
        orgId_provider: { orgId: input.orgId, provider: input.provider },
      },
    });

    let row: ConnectorInstallation;
    try {
      const meta =
        input.meta !== undefined
          ? (input.meta as Prisma.InputJsonValue)
          : undefined;
      if (existing) {
        row = await tx.connectorInstallation.update({
          where: { id: existing.id },
          data: {
            externalId,
            accessTokenRef,
            meta,
          },
        });
      } else {
        row = await tx.connectorInstallation.create({
          data: {
            orgId: input.orgId,
            provider: input.provider,
            externalId,
            accessTokenRef,
            meta,
          },
        });
      }
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new Error(
          `upsertConnectorInstallation: ${input.provider} workspace ${JSON.stringify(externalId)} is already mapped to another organization.`,
        );
      }
      throw err;
    }

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: existing ? 'connector.installation_updated' : 'connector.installation_created',
      target: `${input.provider}:${externalId}`,
      detail: { provider: input.provider, externalId },
    });
    return row;
  });
}

export async function listConnectorInstallations(
  orgId: string,
): Promise<Array<{ provider: string; externalId: string; createdAt: Date }>> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx.connectorInstallation.findMany({
      select: { provider: true, externalId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  });
}

export async function deleteConnectorInstallation(input: {
  orgId: string;
  actorUserId: string;
  provider: ConnectorProvider;
}): Promise<void> {
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);
    const existing = await tx.connectorInstallation.findUnique({
      where: {
        orgId_provider: { orgId: input.orgId, provider: input.provider },
      },
    });
    if (!existing) return;
    await tx.connectorInstallation.delete({ where: { id: existing.id } });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'connector.installation_deleted',
      target: `${input.provider}:${existing.externalId}`,
      detail: { provider: input.provider, externalId: existing.externalId },
    });
  });
}
