export interface Observation {
  sourceKey: string;
  externalRef: string;
  type: string;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ObservationSource {
  key: string;
  fetchObservations(orgId: string, since: Date): Promise<Observation[]>;
}
