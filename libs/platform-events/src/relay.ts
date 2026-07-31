import type { Pool } from 'pg';
import type { Producer } from 'kafkajs';
import {
  claimUnpublished,
  getOutboxStats,
  markPoisoned,
  markPublishFailed,
  markPublished,
} from './outbox';
import { publishOutboxBatch } from './kafka';
import type { OutboxEvent } from './types';

export const DEFAULT_OUTBOX_POISON_ATTEMPTS = 10;

export interface RelayOnceResult {
  claimed: number;
  published: number;
  failed: number;
  poisoned: number;
}

/**
 * One relay tick (two-phase):
 * 1. Claim rows (attempts++, lock) and COMMIT.
 * 2. Publish to Kafka outside the DB lock.
 * 3. Mark published / failed / poisoned.
 *
 * At-least-once: crash between publish and mark republishes; consumers dedupe.
 */
export async function relayOnce(
  pool: Pool,
  schema: string,
  producer: Producer,
  options?: {
    limit?: number;
    poisonAfterAttempts?: number;
    onPoison?: (event: OutboxEvent, error: string) => void;
  },
): Promise<number> {
  const result = await relayOnceDetailed(pool, schema, producer, options);
  return result.published;
}

export async function relayOnceDetailed(
  pool: Pool,
  schema: string,
  producer: Producer,
  options?: {
    limit?: number;
    poisonAfterAttempts?: number;
    onPoison?: (event: OutboxEvent, error: string) => void;
  },
): Promise<RelayOnceResult> {
  const poisonAfter =
    options?.poisonAfterAttempts ?? DEFAULT_OUTBOX_POISON_ATTEMPTS;
  const limit = options?.limit ?? 100;

  // Phase 1: claim under short transaction
  const client = await pool.connect();
  let events: OutboxEvent[] = [];
  try {
    await client.query('BEGIN');
    events = await claimUnpublished(client, schema, {
      limit,
      lockSeconds: 30,
    });
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    client.release();
    throw err;
  }
  client.release();

  if (events.length === 0) {
    return { claimed: 0, published: 0, failed: 0, poisoned: 0 };
  }

  // Phase 2: publish (batch first; fall back to per-event on failure)
  let publishedIds: string[] = [];
  let failed: { event: OutboxEvent; error: string }[] = [];

  try {
    await publishOutboxBatch(producer, events);
    publishedIds = events.map((e) => e.id);
  } catch (batchErr) {
    // Per-event isolation so one poison payload cannot stall the whole claim set.
    for (const event of events) {
      try {
        await publishOutboxBatch(producer, [event]);
        publishedIds.push(event.id);
      } catch (err) {
        failed.push({
          event,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (publishedIds.length === 0 && failed.length === 0) {
      throw batchErr;
    }
  }

  // Phase 3: mark results
  const markClient = await pool.connect();
  let poisoned = 0;
  try {
    await markClient.query('BEGIN');
    await markPublished(markClient, schema, publishedIds);
    for (const f of failed) {
      const attempts = f.event.attempts ?? 1;
      if (attempts >= poisonAfter) {
        await markPoisoned(markClient, schema, f.event.id, f.error);
        poisoned += 1;
        options?.onPoison?.(f.event, f.error);
      } else {
        await markPublishFailed(markClient, schema, f.event.id, f.error);
      }
    }
    await markClient.query('COMMIT');
  } catch (err) {
    try {
      await markClient.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    markClient.release();
  }

  return {
    claimed: events.length,
    published: publishedIds.length,
    failed: failed.length,
    poisoned,
  };
}

export function startOutboxRelay(options: {
  pool: Pool;
  schema: string;
  producer: Producer;
  intervalMs?: number;
  poisonAfterAttempts?: number;
  onError?: (err: unknown) => void;
  onPoison?: (event: OutboxEvent, error: string) => void;
  onStats?: (stats: Awaited<ReturnType<typeof getOutboxStats>>) => void;
  /** How often to emit stats (ticks). Default every 20 ticks. */
  statsEveryTicks?: number;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 500;
  const statsEvery = options.statsEveryTicks ?? 20;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let ticks = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      await relayOnce(options.pool, options.schema, options.producer, {
        ...(options.poisonAfterAttempts !== undefined
          ? { poisonAfterAttempts: options.poisonAfterAttempts }
          : {}),
        ...(options.onPoison ? { onPoison: options.onPoison } : {}),
      });
      ticks += 1;
      if (options.onStats && ticks % statsEvery === 0) {
        const stats = await getOutboxStats(options.pool, options.schema);
        options.onStats(stats);
      }
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
