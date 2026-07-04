import { deliverableSource } from './deliverable';
import type { ObservationSource } from './types';

export type { Observation, ObservationSource } from './types';
export { observationForArtifact } from './deliverable';

export function getObservationSources(): ObservationSource[] {
  return [deliverableSource];
}
