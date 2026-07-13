// Resolve connector workspace → org without a tenant context (bootstrap).
// Mirrors resolveSlackTeam: transaction-local GUCs + SELECT-only lookup policy.
import { prisma } from '../prisma';
import type { ConnectorProvider } from './types';

export interface ConnectorInstallationRef {
  orgId: string;
  accessTokenRef: string | null;
  externalId: string;
}

/**
 * Map provider + external workspace id → org. No mapping ⇒ null (fail-closed).
 * Uses connector_installations_workspace_lookup policy (migration 0033).
 */
export async function resolveConnectorWorkspace(
  provider: ConnectorProvider,
  externalId: string | null | undefined,
): Promise<ConnectorInstallationRef | null> {
  if (!externalId || typeof externalId !== 'string') return null;

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.connector_provider_lookup', ${provider}, true)`;
    await tx.$queryRaw`SELECT set_config('app.connector_external_lookup', ${externalId}, true)`;
    return tx.$queryRaw<
      Array<{ org_id: string; access_token_ref: string | null; external_id: string }>
    >`
      SELECT "org_id", "access_token_ref", "external_id"
      FROM "connector_installations"
      WHERE "provider" = ${provider} AND "external_id" = ${externalId}
    `;
  });

  const row = rows[0];
  if (!row) return null;
  return {
    orgId: row.org_id,
    accessTokenRef: row.access_token_ref,
    externalId: row.external_id,
  };
}
