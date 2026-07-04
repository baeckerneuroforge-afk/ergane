// Shared, server-renderable UI atoms for the dashboard views. Pure display —
// no data access. The chip colors implement the design-system semantics:
// indigo = reads, orange = acts, amber = waits for a human,
// green = completed, red = rejected/failed.
//
// Labels are locale-aware: every component takes the caller's locale (pages
// resolve it once via getI18n()) — the atoms stay synchronous and pure.
import type {
  ActorType,
  ApprovalStatus,
  DocumentVisibility,
  SkillRunStatus,
} from '@prisma/client';
import { getDictionary, type Locale } from '@/lib/i18n';

export { formatDateTime, formatEuro } from '@/lib/i18n';

const RUN_CHIP: Record<SkillRunStatus, string> = {
  running: 'chip--indigo',
  awaiting_approval: 'chip--amber',
  approved: 'chip--green',
  rejected: 'chip--red',
  completed: 'chip--green',
  failed: 'chip--red',
};

export function RunStatusChip({ status, locale }: { status: SkillRunStatus; locale: Locale }) {
  const label = getDictionary(locale).status.run[status];
  return <span className={`chip chip--dot ${RUN_CHIP[status]}`}>{label}</span>;
}

const APPROVAL_CHIP: Record<ApprovalStatus, string> = {
  pending: 'chip--amber',
  approved: 'chip--green',
  rejected: 'chip--red',
};

export function ApprovalStatusChip({
  status,
  locale,
}: {
  status: ApprovalStatus;
  locale: Locale;
}) {
  const label = getDictionary(locale).status.approval[status];
  return <span className={`chip chip--dot ${APPROVAL_CHIP[status]}`}>{label}</span>;
}

const VISIBILITY_CHIP: Record<DocumentVisibility, string> = {
  open: 'chip--gray',
  restricted: 'chip--indigo',
  confidential: 'chip--indigo-dark',
};

export function VisibilityBadge({ visibility }: { visibility: DocumentVisibility }) {
  return <span className={`chip ${VISIBILITY_CHIP[visibility]}`}>{visibility}</span>;
}

export function ActorChip({ actorType, locale }: { actorType: ActorType; locale: Locale }) {
  const t = getDictionary(locale);
  return (
    <span className={`chip ${actorType === 'human' ? 'chip--gray' : 'chip--indigo'}`}>
      {actorType === 'human' ? t.status.actor.human : t.status.actor.agent}
    </span>
  );
}

/** Marks a run as a dry-run ("Probelauf") — a simulation, never a real
 * execution. Used in the run list and the run detail header. */
export function SimulationBadge({ locale }: { locale: Locale }) {
  return (
    <span className="chip chip--dot chip--sim">{getDictionary(locale).status.mode.simulation}</span>
  );
}

// Security view status chip. Deliberately distinguishes a LIVE verified pass
// (green dot — "we just checked the running database") from a test/architecture-
// secured pass (steel-indigo, NO green dot — "secured, but not a momentary
// check"). A live check can also be red ('fail') or amber ('unknown', e.g. the
// DB was unreachable). We never render a green live dot for something that was
// not actually queried live — that separation is the honesty of the view.
export function SecurityStatusChip({
  basis,
  status,
  locale,
}: {
  basis: 'live' | 'test' | 'architecture';
  status: 'pass' | 'fail' | 'unknown';
  locale: Locale;
}) {
  const s = getDictionary(locale).security.chip;
  if (status === 'fail') {
    return <span className="chip chip--dot chip--red">{s.fail}</span>;
  }
  if (status === 'unknown') {
    return <span className="chip chip--dot chip--amber">{s.unknown}</span>;
  }
  // status === 'pass'
  if (basis === 'live') {
    return <span className="chip chip--dot chip--green">{s.liveVerified}</span>;
  }
  // test / architecture: secured, but NOT a live status — no green dot.
  return <span className="chip chip--indigo">{s.secured}</span>;
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
