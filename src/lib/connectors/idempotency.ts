// Idempotency claims for connector webhooks (per tenant + provider).
import { Prisma } from '@prisma/client';
import { withTenant } from '../tenant';
import type { ConnectorProvider } from './types';

/**
 * Atomically claim eventKey for this org+provider.
 * true ⇒ first delivery; false ⇒ duplicate (ack and stop).
 */
export async function claimConnectorEvent(
  orgId: string,
  provider: ConnectorProvider,
  eventKey: string,
): Promise<boolean> {
  if (!eventKey.trim()) {
    throw new Error('claimConnectorEvent: eventKey is required.');
  }
  try {
    await withTenant(orgId, (tx) =>
      tx.connectorProcessedEvent.create({
        data: { orgId, provider, eventKey },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}
