import { deliverableSource } from './deliverable';
import { toolArtifactSource } from './tool_artifact';
import type { ObservationSource } from './types';

export type { Observation, ObservationSource } from './types';
export { observationForArtifact } from './deliverable';
export { toolArtifactSource, MAX_OBSERVATIONS_PER_TICK } from './tool_artifact';

export function getObservationSources(): ObservationSource[] {
  return [deliverableSource, toolArtifactSource];
}

/** Sources evaluated on the periodic tick (not event-driven deliverable path). */
export function getPeriodicObservationSources(): ObservationSource[] {
  return getObservationSources().filter((s) => s.key !== 'deliverable');
}
