import { getBlobProvider } from '../../storage/blob';
import { withTenant } from '../../tenant';
import type { Observation, ObservationSource } from './types';

export const deliverableSource: ObservationSource = {
  key: 'deliverable',

  async fetchObservations(orgId: string, since: Date): Promise<Observation[]> {
    const artifacts = await withTenant(orgId, (tx) =>
      tx.artifact.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          type: true,
          version: true,
          clientId: true,
          runId: true,
          slug: true,
          blobKey: true,
          createdAt: true,
        },
      }),
    );

    const blob = getBlobProvider();
    return Promise.all(
      artifacts.map(async (art): Promise<Observation> => {
        let content: string | null = null;
        try {
          const data = await blob.get(art.blobKey);
          if (data) content = new TextDecoder().decode(data.bytes);
        } catch {
          // Blob unavailable — degrade gracefully.
        }
        return {
          sourceKey: 'deliverable',
          externalRef: art.id,
          type: art.type,
          content,
          metadata: {
            version: art.version,
            clientId: art.clientId,
            runId: art.runId,
            slug: art.slug,
            title: art.title,
          },
          createdAt: art.createdAt,
        };
      }),
    );
  },
};

/**
 * Build an Observation for a SINGLE artifact by id. Blob content is loaded
 * OUTSIDE any withTenant transaction (the non-negotiable rule).
 */
export async function observationForArtifact(
  orgId: string,
  artifactId: string,
): Promise<Observation | null> {
  const art = await withTenant(orgId, (tx) =>
    tx.artifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        title: true,
        type: true,
        version: true,
        clientId: true,
        runId: true,
        slug: true,
        blobKey: true,
        createdAt: true,
      },
    }),
  );
  if (!art) return null;

  const blob = getBlobProvider();
  let content: string | null = null;
  try {
    const data = await blob.get(art.blobKey);
    if (data) content = new TextDecoder().decode(data.bytes);
  } catch {
    // Blob unavailable — degrade gracefully.
  }

  return {
    sourceKey: 'deliverable',
    externalRef: art.id,
    type: art.type,
    content,
    metadata: {
      version: art.version,
      clientId: art.clientId,
      runId: art.runId,
      slug: art.slug,
      title: art.title,
    },
    createdAt: art.createdAt,
  };
}
