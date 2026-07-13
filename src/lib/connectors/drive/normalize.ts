// Pure normalize for Google Drive / Docs file payloads.
import type { NormalizedToolItem } from '../types';

export interface DriveFilePayload {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  /** Extracted plain text (caller/fetch layer supplies this). */
  text?: string;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
  /** Workspace / shared drive id for tenant mapping. */
  driveId?: string;
  /** OAuth user or shared-drive external id. */
  workspaceId?: string;
}

export function driveExternalRef(fileId: string): string {
  return `drive:file:${fileId}`;
}

export function normalizeDriveFile(data: DriveFilePayload): NormalizedToolItem | null {
  const id = data.id?.trim();
  const name = (data.name ?? '').trim();
  if (!id || !name) return null;
  const body = (data.text ?? '').trim() || name;
  const text = [
    `# ${name}`,
    data.mimeType ? `\nMIME: ${data.mimeType}` : '',
    data.webViewLink ? `\nURL: ${data.webViewLink}` : '',
    '',
    body,
  ]
    .join('\n')
    .trim();

  return {
    externalRef: driveExternalRef(id),
    title: name.slice(0, 500),
    text,
    source: 'doc',
    sourceMeta: {
      provider: 'drive',
      fileId: id,
      mimeType: data.mimeType ?? null,
      url: data.webViewLink ?? null,
      lastActivityAt: data.modifiedTime ?? data.createdTime ?? null,
      owner: data.owners?.[0]?.emailAddress ?? data.owners?.[0]?.displayName ?? null,
      text,
    },
    occurredAt: data.modifiedTime
      ? new Date(data.modifiedTime)
      : data.createdTime
        ? new Date(data.createdTime)
        : undefined,
  };
}
