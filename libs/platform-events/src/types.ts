export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  partitionKey: string;
  payload: Record<string, unknown>;
  topic: string;
}

export interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
