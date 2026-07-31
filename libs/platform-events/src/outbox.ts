import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import type { OutboxEvent } from './types';

/**
 * SQL to create an outbox table in a service schema (e.g. post.outbox).
 * Includes reliability columns (attempts / lock / poison).
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
  published_at    timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_error      text,
  poisoned_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ix_${schema}_outbox_unpublished
  ON ${schema}.outbox (created_at)
  WHERE published_at IS NULL AND poisoned_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_${schema}_outbox_claimable
  ON ${schema}.outbox (id)
  WHERE published_at IS NULL AND poisoned_at IS NULL;
`;
}

/** ALTER path for services that already shipped a minimal outbox table. */
export function outboxReliabilityAlterDdl(schema: string): string {
  return `
ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS poisoned_at timestamptz;
CREATE INDEX IF NOT EXISTS ix_${schema}_outbox_claimable
  ON ${schema}.outbox (id)
  WHERE published_at IS NULL AND poisoned_at IS NULL;
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

export interface ClaimOptions {
  limit?: number;
  lockSeconds?: number;
}

/**
 * Claim unpublished, non-poisoned rows with SKIP LOCKED.
 * Bumps attempts and sets locked_until so concurrent relays do not double-claim.
 * Caller should COMMIT after claim, publish outside the lock, then mark results.
 */
export async function claimUnpublished(
  client: PoolClient,
  schema: string,
  limitOrOptions: number | ClaimOptions = 100,
): Promise<OutboxEvent[]> {
  const opts: ClaimOptions =
    typeof limitOrOptions === 'number'
      ? { limit: limitOrOptions }
      : limitOrOptions;
  const limit = opts.limit ?? 100;
  const lockSeconds = opts.lockSeconds ?? 30;

  const result = await client.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    partition_key: string;
    topic: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `WITH claimed AS (
       SELECT id
       FROM ${schema}.outbox
       WHERE published_at IS NULL
         AND poisoned_at IS NULL
         AND (locked_until IS NULL OR locked_until < now())
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE ${schema}.outbox o
        SET attempts = o.attempts + 1,
            locked_until = now() + ($2::text || ' seconds')::interval,
            last_error = NULL
       FROM claimed
      WHERE o.id = claimed.id
      RETURNING o.id, o.aggregate_type, o.aggregate_id, o.event_type,
                o.partition_key, o.topic, o.payload, o.attempts`,
    [limit, String(lockSeconds)],
  );

  return result.rows.map((r) => ({
    id: r.id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    eventType: r.event_type,
    partitionKey: r.partition_key,
    topic: r.topic,
    payload: r.payload,
    attempts: Number(r.attempts),
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
     SET published_at = now(),
         locked_until = NULL,
         last_error = NULL
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function markPublishFailed(
  client: PoolClient,
  schema: string,
  id: string,
  error: string,
  options?: { poison?: boolean },
): Promise<void> {
  if (options?.poison) {
    await client.query(
      `UPDATE ${schema}.outbox
       SET last_error = $2,
           poisoned_at = now(),
           locked_until = NULL
       WHERE id = $1::uuid`,
      [id, error.slice(0, 2000)],
    );
    return;
  }
  await client.query(
    `UPDATE ${schema}.outbox
     SET last_error = $2,
         locked_until = NULL
     WHERE id = $1::uuid`,
    [id, error.slice(0, 2000)],
  );
}

export async function markPoisoned(
  client: PoolClient,
  schema: string,
  id: string,
  error: string,
): Promise<void> {
  await markPublishFailed(client, schema, id, error, { poison: true });
}

export interface OutboxStats {
  unpublished: number;
  poisoned: number;
  oldestAgeSeconds: number | null;
  maxAttempts: number;
}

export async function getOutboxStats(
  pool: Pool,
  schema: string,
): Promise<OutboxStats> {
  const r = await pool.query<{
    unpublished: string;
    poisoned: string;
    oldest_age_seconds: string | null;
    max_attempts: string | null;
  }>(
    `SELECT
       count(*) FILTER (
         WHERE published_at IS NULL AND poisoned_at IS NULL
       )::text AS unpublished,
       count(*) FILTER (WHERE poisoned_at IS NOT NULL)::text AS poisoned,
       EXTRACT(EPOCH FROM (now() - min(created_at)
         FILTER (WHERE published_at IS NULL AND poisoned_at IS NULL)
       ))::text AS oldest_age_seconds,
       coalesce(max(attempts) FILTER (
         WHERE published_at IS NULL AND poisoned_at IS NULL
       ), 0)::text AS max_attempts
     FROM ${schema}.outbox`,
  );
  const row = r.rows[0];
  return {
    unpublished: Number(row?.unpublished ?? 0),
    poisoned: Number(row?.poisoned ?? 0),
    oldestAgeSeconds:
      row?.oldest_age_seconds == null
        ? null
        : Math.max(0, Math.floor(Number(row.oldest_age_seconds))),
    maxAttempts: Number(row?.max_attempts ?? 0),
  };
}
