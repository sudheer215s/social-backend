import type { Pool } from 'pg';
import type { Producer } from 'kafkajs';
import { claimUnpublished, markPublished } from './outbox';
import { publishOutboxBatch } from './kafka';

/**
 * One relay tick: claim unpublished rows, publish to Kafka, mark published.
 * Run on an interval inside each owning service (or a sidecar later).
 */
export async function relayOnce(
  pool: Pool,
  schema: string,
  producer: Producer,
  limit = 100,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events = await claimUnpublished(client, schema, limit);
    if (events.length === 0) {
      await client.query('COMMIT');
      return 0;
    }
    // Publish outside the DB lock as much as possible: we hold SKIP LOCKED rows.
    await publishOutboxBatch(producer, events);
    await markPublished(
      client,
      schema,
      events.map((e) => e.id),
    );
    await client.query('COMMIT');
    return events.length;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

export function startOutboxRelay(options: {
  pool: Pool;
  schema: string;
  producer: Producer;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 500;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await relayOnce(options.pool, options.schema, options.producer);
    } catch (err) {
      options.onError?.(err);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, intervalMs);
      }
    }
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
