import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import type { OutboxEvent } from './types';

/**
 * SQL to create an outbox table in a service schema (e.g. post.outbox).
 */
export function outboxDdl(schema: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${schema}.outbox (
  id              uuid PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  event_type      text NOT NULL,
  partition_key   text NOT NULL,
  topic           text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_${schema}_outbox_unpublished
  ON ${schema}.outbox (created_at)
  WHERE published_at IS NULL;
`;
}

export interface AppendOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  partitionKey: string;
  topic: string;
  payload: Record<string, unknown>;
}

/**
 * Append an event inside an existing transaction (must pass tx client).
 * Closes the dual-write problem by type: no publish without the same tx.
 */
export async function appendOutbox(
  client: PoolClient,
  schema: string,
  input: AppendOutboxInput,
): Promise<OutboxEvent> {
  const id = uuidv7();
  await client.query(
    `INSERT INTO ${schema}.outbox
       (id, aggregate_type, aggregate_id, event_type, partition_key, topic, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      id,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.partitionKey,
      input.topic,
      JSON.stringify(input.payload),
    ],
  );
  return {
    id,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    partitionKey: input.partitionKey,
    topic: input.topic,
    payload: input.payload,
  };
}

export async function claimUnpublished(
  client: PoolClient,
  schema: string,
  limit = 100,
): Promise<OutboxEvent[]> {
  const result = await client.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    partition_key: string;
    topic: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT id, aggregate_type, aggregate_id, event_type, partition_key, topic, payload
     FROM ${schema}.outbox
     WHERE published_at IS NULL
     ORDER BY id
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    eventType: r.event_type,
    partitionKey: r.partition_key,
    topic: r.topic,
    payload: r.payload,
  }));
}

export async function markPublished(
  client: PoolClient,
  schema: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await client.query(
    `UPDATE ${schema}.outbox
     SET published_at = now()
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}
