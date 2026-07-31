export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  partitionKey: string;
  payload: Record<string, unknown>;
  topic: string;
  /** Set after claim; 1-based attempt count for this publish try. */
  attempts?: number;
}

export interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Failure classes for the non-blocking consumer retry ladder. */
export type ErrorClass = 'transient' | 'poison' | 'semantic';

export interface DlqEnvelope {
  originalTopic: string;
  originalPartitionKey: string | null;
  failedAt: string;
  errorClass: ErrorClass;
  errorMessage: string;
  retryTierExhausted: number;
  consumerGroup: string;
  envelope: DomainEventEnvelope;
}
