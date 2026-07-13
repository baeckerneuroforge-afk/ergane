// Phase-2 observation source: tool-ingested documents (tickets/code/docs)
// with external_ref. Reads metadata inside withTenant; no blob/network needed
// (text lives in the document title + source_meta; optional chunk join is a
// pure DB read outside long work).
import { withTenant } from '../../tenant';
import type { Observation, ObservationSource } from './types';

/** Cap per tick to limit alarm volume (loop-schritt-f-plan §6). */
export const MAX_OBSERVATIONS_PER_TICK = 50;

type SourceMeta = Record<string, unknown>;

function asMeta(raw: unknown): SourceMeta {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as SourceMeta;
  }
  return {};
}

export const toolArtifactSource: ObservationSource = {
  key: 'tool_artifact',

  async fetchObservations(orgId: string, since: Date): Promise<Observation[]> {
    const docs = await withTenant(orgId, (tx) =>
      tx.document.findMany({
        where: {
          source: { in: ['ticket', 'code', 'doc'] },
          createdAt: { gte: since },
          externalRef: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_OBSERVATIONS_PER_TICK,
        select: {
          id: true,
          title: true,
          source: true,
          externalRef: true,
          sourceMeta: true,
          createdAt: true,
        },
      }),
    );

    return docs
      .filter((d): d is typeof d & { externalRef: string } => Boolean(d.externalRef))
      .map((d) => {
        const meta = asMeta(d.sourceMeta);
        const textFromMeta =
          typeof meta.text === 'string'
            ? meta.text
            : typeof meta.description === 'string'
              ? `${d.title}\n${meta.description}`
              : d.title;
        return {
          sourceKey: 'tool_artifact' as const,
          externalRef: d.externalRef,
          type: d.source, // 'ticket' | 'code' | 'doc'
          content: textFromMeta,
          metadata: {
            documentId: d.id,
            title: d.title,
            ...meta,
          },
          createdAt: d.createdAt,
        } satisfies Observation;
      });
  },
};
