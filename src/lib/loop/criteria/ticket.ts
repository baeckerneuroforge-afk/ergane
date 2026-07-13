// Deterministic acceptance criteria for tool tickets (type='ticket').
// Pure functions over Observation.metadata — no DB, no LLM, no network.
// Missing fields ⇒ pass (not measurable ≠ violated) — plan §7.
import type { Observation } from '../sources/types';
import type { AcceptanceCriteriaSet, AcceptanceCriterion, CriterionResult } from './types';

/** Days without activity before an open ticket is "stale". Conservative default. */
export const STALE_DAYS = 14;
/** Grace period before unassigned / no-sprint flags fire. */
export const GRACE_DAYS = 2;

function metaString(obs: Observation, key: string): string | null {
  const v = obs.metadata[key];
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function metaDate(obs: Observation, key: string): Date | null {
  const v = obs.metadata[key];
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isOpen(obs: Observation): boolean | null {
  const state = metaString(obs, 'state')?.toLowerCase() ?? null;
  if (!state) return null; // not measurable
  if (state === 'completed' || state === 'canceled' || state === 'cancelled' || state === 'done') {
    return false;
  }
  // Known open types, or any other non-terminal label → treat as open.
  return true;
}

/** Injectable "now" for tests — criteria read from obs.metadata.now when set. */
function nowOf(obs: Observation): Date {
  const injected = metaDate(obs, 'now');
  return injected ?? new Date();
}

const ticketOverdue: AcceptanceCriterion = {
  key: 'ticket_overdue',
  label: 'Ticket not overdue',
  check: (obs: Observation): CriterionResult => {
    const open = isOpen(obs);
    const due = metaDate(obs, 'dueDate');
    if (open === null || due === null) {
      return {
        key: 'ticket_overdue',
        passed: true,
        detail: {
          expected: 'not overdue (or not measurable)',
          actual: 'n/a',
          message: 'dueDate or state missing — not measurable',
        },
      };
    }
    if (!open) {
      return {
        key: 'ticket_overdue',
        passed: true,
        detail: { expected: 'not overdue', actual: 'closed', message: 'Ticket is closed' },
      };
    }
    const now = nowOf(obs);
    const overdue = due.getTime() < now.getTime();
    return {
      key: 'ticket_overdue',
      passed: !overdue,
      detail: {
        expected: `dueDate >= ${now.toISOString().slice(0, 10)}`,
        actual: due.toISOString().slice(0, 10),
        message: overdue
          ? `Open ticket overdue (due ${due.toISOString().slice(0, 10)})`
          : 'Open ticket is within due date',
      },
    };
  },
};

const ticketStale: AcceptanceCriterion = {
  key: 'ticket_stale',
  label: 'Ticket has recent activity',
  check: (obs: Observation): CriterionResult => {
    const open = isOpen(obs);
    const last = metaDate(obs, 'lastActivityAt') ?? metaDate(obs, 'createdAt') ?? obs.createdAt;
    if (open === null) {
      return {
        key: 'ticket_stale',
        passed: true,
        detail: {
          expected: `activity within ${STALE_DAYS}d`,
          actual: 'n/a',
          message: 'state missing — not measurable',
        },
      };
    }
    if (!open) {
      return {
        key: 'ticket_stale',
        passed: true,
        detail: { expected: 'active or closed', actual: 'closed', message: 'Ticket is closed' },
      };
    }
    const now = nowOf(obs);
    const ageDays = (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
    const stale = ageDays > STALE_DAYS;
    return {
      key: 'ticket_stale',
      passed: !stale,
      detail: {
        expected: `≤ ${STALE_DAYS} days since activity`,
        actual: Math.floor(ageDays),
        message: stale
          ? `Open ticket stale (${Math.floor(ageDays)} days since last activity)`
          : `Activity within ${STALE_DAYS} days`,
      },
    };
  },
};

const ticketUnassigned: AcceptanceCriterion = {
  key: 'ticket_unassigned',
  label: 'Ticket assigned after grace',
  check: (obs: Observation): CriterionResult => {
    const open = isOpen(obs);
    const assignee = metaString(obs, 'assigneeId');
    const created =
      metaDate(obs, 'createdAt') ?? obs.createdAt;
    if (open === null) {
      return {
        key: 'ticket_unassigned',
        passed: true,
        detail: {
          expected: 'assigned',
          actual: 'n/a',
          message: 'state missing — not measurable',
        },
      };
    }
    if (!open) {
      return {
        key: 'ticket_unassigned',
        passed: true,
        detail: { expected: 'assigned or closed', actual: 'closed', message: 'Ticket is closed' },
      };
    }
    const now = nowOf(obs);
    const ageDays = (now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays <= GRACE_DAYS) {
      return {
        key: 'ticket_unassigned',
        passed: true,
        detail: {
          expected: `assigned after ${GRACE_DAYS}d grace`,
          actual: 'within grace',
          message: 'Still within assignment grace period',
        },
      };
    }
    const hasAssignee = Boolean(assignee && assignee !== 'null');
    // Missing assigneeId field entirely after grace → treat as unassigned only if key present as null
    // or absent with open state older than grace (Linear always sends assigneeId: null).
    const unassigned = !hasAssignee;
    return {
      key: 'ticket_unassigned',
      passed: !unassigned,
      detail: {
        expected: 'assignee set',
        actual: hasAssignee ? assignee : null,
        message: unassigned
          ? `Open ticket unassigned for ${Math.floor(ageDays)} days`
          : 'Ticket has an assignee',
      },
    };
  },
};

const ticketNoSprint: AcceptanceCriterion = {
  key: 'ticket_no_sprint',
  label: 'Ticket in a sprint/cycle after grace',
  check: (obs: Observation): CriterionResult => {
    const open = isOpen(obs);
    const sprint = metaString(obs, 'sprintId');
    const created = metaDate(obs, 'createdAt') ?? obs.createdAt;
    if (open === null) {
      return {
        key: 'ticket_no_sprint',
        passed: true,
        detail: {
          expected: 'sprint set',
          actual: 'n/a',
          message: 'state missing — not measurable',
        },
      };
    }
    if (!open) {
      return {
        key: 'ticket_no_sprint',
        passed: true,
        detail: { expected: 'sprint or closed', actual: 'closed', message: 'Ticket is closed' },
      };
    }
    const now = nowOf(obs);
    const ageDays = (now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays <= GRACE_DAYS) {
      return {
        key: 'ticket_no_sprint',
        passed: true,
        detail: {
          expected: `sprint after ${GRACE_DAYS}d grace`,
          actual: 'within grace',
          message: 'Still within sprint-assignment grace period',
        },
      };
    }
    const hasSprint = Boolean(sprint && sprint !== 'null');
    return {
      key: 'ticket_no_sprint',
      passed: hasSprint,
      detail: {
        expected: 'sprint/cycle set',
        actual: hasSprint ? sprint : null,
        message: hasSprint
          ? 'Ticket is in a sprint/cycle'
          : `Open ticket has no sprint for ${Math.floor(ageDays)} days`,
      },
    };
  },
};

const AC_MARKERS = [/acceptance\s*criteria/i, /\bAC\s*:/i, /akzeptanzkriterien/i];

const ticketMissingAcceptance: AcceptanceCriterion = {
  key: 'ticket_missing_acceptance',
  label: 'Ticket has acceptance criteria markers',
  check: (obs: Observation): CriterionResult => {
    const open = isOpen(obs);
    // Content = title (+ description was folded into ingest text; we only have title
    // on Observation.content for tool source). Prefer metadata description if set.
    const body =
      (typeof obs.metadata.description === 'string' ? obs.metadata.description : null) ??
      obs.content ??
      '';
    // Also scan full text if present in metadata
    const full =
      (typeof obs.metadata.text === 'string' ? obs.metadata.text : null) ?? body;

    if (open === false) {
      return {
        key: 'ticket_missing_acceptance',
        passed: true,
        detail: { expected: 'AC markers or closed', actual: 'closed', message: 'Ticket is closed' },
      };
    }
    // If state missing, still check markers (measurable via text alone).
    const found = AC_MARKERS.some((re) => re.test(full));
    return {
      key: 'ticket_missing_acceptance',
      passed: found,
      detail: {
        expected: 'Acceptance / AC: / Akzeptanzkriterien marker',
        actual: found ? 'present' : 'missing',
        message: found
          ? 'Acceptance criteria marker found'
          : 'No acceptance criteria marker in ticket text',
      },
    };
  },
};

export const ticketCriteria: AcceptanceCriteriaSet = {
  type: 'ticket',
  criteria: [
    ticketOverdue,
    ticketStale,
    ticketUnassigned,
    ticketNoSprint,
    ticketMissingAcceptance,
  ],
};

// Re-export registry helper for callers that imported from ticket.ts historically.
export { getCriteriaForObservationType } from './registry';
