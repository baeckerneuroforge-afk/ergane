// Thin connector contract (OS Bauplan Teil F). Implementations live under
// ./linear (and later github, …). The engine for reading tools is:
//   verify webhook/signature → resolve workspace → org → claim event →
//   normalize → ingestDocument (with externalRef + restricted visibility).

import type { DocumentSource } from '@prisma/client';

export type ConnectorProvider = 'linear' | 'github' | 'drive';

/** Normalized payload ready for ingestDocument (no network, pure data). */
export interface NormalizedToolItem {
  externalRef: string;
  title: string;
  text: string;
  source: DocumentSource;
  /** Loop-checkable fields (dueDate, state, assigneeId, lastActivityAt, …). */
  sourceMeta: Record<string, unknown>;
  /** When the item was created/updated in the external system (ISO or Date). */
  occurredAt?: Date;
}

export interface ConnectorDef {
  key: ConnectorProvider;
  /** Human label for settings / connectors page. */
  label: string;
}
