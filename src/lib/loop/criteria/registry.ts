// Map observation type → acceptance criteria set for the periodic tick.
import type { AcceptanceCriteriaSet } from './types';
import { ticketCriteria } from './ticket';
import { codeCriteria } from './code';

export function getCriteriaForObservationType(type: string): AcceptanceCriteriaSet | null {
  if (type === 'ticket') return ticketCriteria;
  if (type === 'code') return codeCriteria;
  return null;
}
