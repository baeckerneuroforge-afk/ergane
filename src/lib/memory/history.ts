import { getBlobProvider } from '../storage/blob';
import { withTenant } from '../tenant';

const MAX_RUNS = 10;
const MAX_DELIVERABLES = 5;
const MAX_CONTENT_CHARS = 8000;

export interface PriorRun {
  skillKey: string;
  status: string;
  createdAt: Date;
}

export interface PriorDeliverable {
  title: string;
  type: string;
  version: number;
  content: string | null;
}

export interface ClientHistory {
  clientName: string;
  notes: string | null;
  runs: PriorRun[];
  deliverables: PriorDeliverable[];
}

/**
 * Load a client's history: prior runs, latest deliverables (with blob content),
 * and the client note. Tenant-isolated via withTenant/RLS.
 *
 * The blob-get calls (external network) happen AFTER the withTenant transaction
 * returns — they are never inside a tenant Tx. This function is designed to be
 * called from a prepare() hook (pre-Tx), never from inside a withTenant block.
 */
export async function getClientHistory(
  clientId: string,
  orgId: string,
): Promise<ClientHistory> {
  const { client, runs, artifacts } = await withTenant(orgId, async (tx) => {
    const c = await tx.client.findUnique({
      where: { id: clientId },
      select: { name: true, notes: true },
    });
    if (!c) {
      return { client: null, runs: [], artifacts: [] };
    }

    const r = await tx.skillRun.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: MAX_RUNS,
      select: { skillKey: true, status: true, createdAt: true },
    });

    // Latest version per slug — the version chain groups deliverables logically.
    // Raw query: for each distinct slug pick the row with the highest version.
    const a = await tx.artifact.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        type: true,
        version: true,
        blobKey: true,
        slug: true,
      },
    });

    // Keep only the newest version per slug (first occurrence, already desc).
    const seen = new Set<string>();
    const latest = a.filter((art) => {
      const key = art.slug ?? art.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_DELIVERABLES);

    return { client: c, runs: r, artifacts: latest };
  });

  if (!client) {
    return { clientName: '', notes: null, runs: [], deliverables: [] };
  }

  // Blob content loading — OUTSIDE the withTenant Tx (network calls).
  const blob = getBlobProvider();
  const deliverables: PriorDeliverable[] = await Promise.all(
    artifacts.map(async (art) => {
      let content: string | null = null;
      try {
        const data = await blob.get(art.blobKey);
        if (data) {
          const text = new TextDecoder().decode(data.bytes);
          content = text.length > MAX_CONTENT_CHARS
            ? text.slice(0, MAX_CONTENT_CHARS) + '\n[…truncated]'
            : text;
        }
      } catch {
        // Blob unavailable — degrade gracefully, still return metadata.
      }
      return {
        title: art.title,
        type: art.type,
        version: art.version,
        content,
      };
    }),
  );

  return {
    clientName: client.name,
    notes: client.notes,
    runs: runs.map((r) => ({
      skillKey: r.skillKey,
      status: r.status,
      createdAt: r.createdAt,
    })),
    deliverables,
  };
}
