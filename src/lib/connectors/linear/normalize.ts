// Pure normalize: Linear Issue webhook payload → NormalizedToolItem.
// No network, no DB — fully unit-testable.
import type { NormalizedToolItem } from '../types';

export interface LinearIssueState {
  id?: string;
  name?: string;
  /** Linear state type: backlog | unstarted | started | completed | canceled */
  type?: string;
}

export interface LinearIssueData {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  assigneeId?: string | null;
  cycleId?: string | null;
  stateId?: string | null;
  state?: LinearIssueState | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  priority?: number | null;
}

export interface LinearWebhookPayload {
  action?: string;
  type?: string;
  data?: LinearIssueData;
  organizationId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
  createdAt?: string;
}

/** Open (not done/canceled) Linear state types for loop criteria. */
export const OPEN_STATE_TYPES = new Set(['backlog', 'unstarted', 'started']);

export function isIssueEvent(payload: LinearWebhookPayload): boolean {
  return payload.type === 'Issue' && Boolean(payload.data?.id);
}

export function shouldIngestAction(action: string | undefined): boolean {
  return action === 'create' || action === 'update';
}

/**
 * Build a stable external_ref for a Linear issue.
 * Format: linear:issue:<uuid>
 */
export function linearIssueExternalRef(issueId: string): string {
  return `linear:issue:${issueId}`;
}

/**
 * Normalize a Linear Issue webhook data blob into an ingest-ready item.
 * Returns null when required fields are missing (fail-closed, skip).
 */
export function normalizeLinearIssue(data: LinearIssueData): NormalizedToolItem | null {
  const id = data.id?.trim();
  const title = (data.title ?? data.identifier ?? '').trim();
  if (!id || !title) return null;

  const identifier = data.identifier?.trim() || id;
  const description = (data.description ?? '').trim();
  const stateType = data.state?.type?.toLowerCase() ?? null;
  const stateName = data.state?.name ?? null;
  const textParts = [
    `# ${identifier}: ${title}`,
    description ? `\n${description}` : '',
    stateName ? `\n\nStatus: ${stateName}` : '',
    data.dueDate ? `\nDue: ${data.dueDate}` : '',
    data.url ? `\nURL: ${data.url}` : '',
  ];
  const text = textParts.join('').trim();
  if (!text) return null;

  const updatedAt = data.updatedAt ? new Date(data.updatedAt) : undefined;
  const createdAt = data.createdAt ? new Date(data.createdAt) : undefined;

  return {
    externalRef: linearIssueExternalRef(id),
    title: `${identifier}: ${title}`.slice(0, 500),
    text,
    source: 'ticket',
    sourceMeta: {
      provider: 'linear',
      issueId: id,
      identifier,
      state: stateType,
      stateName,
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate ?? null,
      sprintId: data.cycleId ?? null,
      lastActivityAt: (updatedAt ?? createdAt)?.toISOString() ?? null,
      createdAt: createdAt?.toISOString() ?? null,
      url: data.url ?? null,
      priority: data.priority ?? null,
      // Full text for loop criteria (acceptance markers) without re-reading chunks.
      description: description || null,
      text,
    },
    occurredAt: updatedAt ?? createdAt,
  };
}
