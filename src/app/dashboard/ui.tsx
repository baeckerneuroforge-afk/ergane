// Shared, server-renderable UI atoms for the dashboard views. Pure display —
// no data access. The chip colors implement the design-system semantics:
// indigo = liest, orange = handelt, bernstein = wartet auf Mensch,
// grün = completed, rot = rejected/failed.
import type {
  ActorType,
  ApprovalStatus,
  DocumentVisibility,
  SkillRunStatus,
} from '@prisma/client';

export const RUN_STATUS: Record<SkillRunStatus, { label: string; chip: string }> = {
  running: { label: 'läuft', chip: 'chip--indigo' },
  awaiting_approval: { label: 'wartet auf Freigabe', chip: 'chip--amber' },
  approved: { label: 'freigegeben', chip: 'chip--green' },
  rejected: { label: 'abgelehnt', chip: 'chip--red' },
  completed: { label: 'abgeschlossen', chip: 'chip--green' },
  failed: { label: 'fehlgeschlagen', chip: 'chip--red' },
};

export function RunStatusChip({ status }: { status: SkillRunStatus }) {
  const { label, chip } = RUN_STATUS[status];
  return <span className={`chip ${chip}`}>{label}</span>;
}

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; chip: string }> = {
  pending: { label: 'offen', chip: 'chip--amber' },
  approved: { label: 'freigegeben', chip: 'chip--green' },
  rejected: { label: 'abgelehnt', chip: 'chip--red' },
};

export function ApprovalStatusChip({ status }: { status: ApprovalStatus }) {
  const { label, chip } = APPROVAL_STATUS[status];
  return <span className={`chip ${chip}`}>{label}</span>;
}

const VISIBILITY_CHIP: Record<DocumentVisibility, string> = {
  open: 'chip--gray',
  restricted: 'chip--indigo',
  confidential: 'chip--indigo-dark',
};

export function VisibilityBadge({ visibility }: { visibility: DocumentVisibility }) {
  return <span className={`chip ${VISIBILITY_CHIP[visibility]}`}>{visibility}</span>;
}

export function ActorChip({ actorType }: { actorType: ActorType }) {
  return (
    <span className={`chip ${actorType === 'human' ? 'chip--gray' : 'chip--indigo'}`}>
      {actorType === 'human' ? 'Mensch' : 'Agent'}
    </span>
  );
}

const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(d: Date): string {
  return DATE_TIME.format(d);
}

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuro(n: number): string {
  return EURO.format(n);
}

/** Monetary amount of a run input (beleg_kontieren convention), if present. */
export function amountOfInput(input: unknown): number | null {
  if (input && typeof input === 'object' && 'betragEur' in input) {
    const v = (input as Record<string, unknown>).betragEur;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
