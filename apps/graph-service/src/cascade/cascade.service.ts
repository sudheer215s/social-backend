import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { uuidv7 } from 'uuidv7';

const CONSUMER_GROUP = 'graph-cascade';
const BATCH = 5_000;

/**
 * Enqueue edge-removal jobs on user.erased; worker deletes in batches
 * so a multi-million-edge account never blocks the Kafka poll loop.
 */
@Injectable()
export class CascadeService {
  private readonly log = new Logger(CascadeService.name);

  constructor(private readonly pool: Pool) {}

  async processDomainEvent(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<'handled' | 'duplicate' | 'skipped'> {
    if (input.eventType !== 'user.erased') return 'skipped';
    const userId = asString(input.payload.userId);
    if (!userId) return 'skipped';

    return withTransaction(this.pool, async (client) => {
      const dedupe = await client.query(
        `INSERT INTO graph.processed_events (consumer_group, event_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [CONSUMER_GROUP, input.eventId],
      );
      if ((dedupe.rowCount ?? 0) === 0) {
        return 'duplicate';
      }

      const id = uuidv7();
      await client.query(
        `INSERT INTO graph.cascade_jobs (id, user_id, kind, status)
         SELECT $1, $2::uuid, 'user.erased', 'pending'
         WHERE NOT EXISTS (
           SELECT 1 FROM graph.cascade_jobs
           WHERE user_id = $2::uuid
             AND kind = 'user.erased'
             AND status IN ('pending', 'running')
         )`,
        [id, userId],
      );
      return 'handled';
    });
  }

  /**
   * One worker tick: claim a job and delete edges in limited batches.
   * Returns true if any work was done.
   */
  async runOnce(): Promise<boolean> {
    const job = await this.claimJob();
    if (!job) return false;

    try {
      let total = 0;
      // follows where user is follower or followee
      total += await this.deleteBatched(
        job.id,
        'follows',
        `DELETE FROM graph.follows
         WHERE ctid IN (
           SELECT ctid FROM graph.follows
           WHERE follower_id = $1 OR followee_id = $1
           LIMIT $2
         )`,
        job.userId,
      );
      total += await this.deleteBatched(
        job.id,
        'blocks',
        `DELETE FROM graph.blocks
         WHERE ctid IN (
           SELECT ctid FROM graph.blocks
           WHERE blocker_id = $1 OR blocked_id = $1
           LIMIT $2
         )`,
        job.userId,
      );
      total += await this.deleteBatched(
        job.id,
        'mutes',
        `DELETE FROM graph.mutes
         WHERE ctid IN (
           SELECT ctid FROM graph.mutes
           WHERE muter_id = $1 OR muted_id = $1
           LIMIT $2
         )`,
        job.userId,
      );

      // If no more edges, mark done; else re-queue as pending for next tick
      const remaining = await this.remainingEdges(job.userId);
      if (remaining === 0) {
        await this.pool.query(
          `UPDATE graph.cascade_jobs
           SET status = 'done', completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [job.id],
        );
        this.log.log(`cascade done user=${job.userId} deleted≈${total}`);
      } else {
        await this.pool.query(
          `UPDATE graph.cascade_jobs
           SET status = 'pending', updated_at = now()
           WHERE id = $1`,
          [job.id],
        );
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.pool.query(
        `UPDATE graph.cascade_jobs
         SET status = 'failed', last_error = $2, updated_at = now(),
             attempts = attempts + 1
         WHERE id = $1`,
        [job.id, msg.slice(0, 2000)],
      );
      // Re-open for retry if attempts low
      await this.pool.query(
        `UPDATE graph.cascade_jobs
         SET status = 'pending'
         WHERE id = $1 AND attempts < 20`,
        [job.id],
      );
      throw err;
    }
  }

  private async claimJob(): Promise<{ id: string; userId: string } | null> {
    return withTransaction(this.pool, async (client) => {
      const r = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM graph.cascade_jobs
         WHERE status = 'pending'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      const row = r.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE graph.cascade_jobs
         SET status = 'running', updated_at = now(), attempts = attempts + 1
         WHERE id = $1`,
        [row.id],
      );
      return { id: row.id, userId: row.user_id };
    });
  }

  private async deleteBatched(
    jobId: string,
    counter: 'follows' | 'blocks' | 'mutes',
    sql: string,
    userId: string,
  ): Promise<number> {
    // Up to 3 batches per tick per table to make progress without long locks
    let deleted = 0;
    for (let i = 0; i < 3; i++) {
      const r = await this.pool.query(sql, [userId, BATCH]);
      const n = r.rowCount ?? 0;
      deleted += n;
      if (n === 0) break;
    }
    if (deleted > 0) {
      const col =
        counter === 'follows'
          ? 'follows_done'
          : counter === 'blocks'
            ? 'blocks_done'
            : 'mutes_done';
      await this.pool.query(
        `UPDATE graph.cascade_jobs
         SET ${col} = ${col} + $2, updated_at = now()
         WHERE id = $1`,
        [jobId, deleted],
      );
    }
    return deleted;
  }

  private async remainingEdges(userId: string): Promise<number> {
    const r = await this.pool.query<{ c: string }>(
      `SELECT (
         (SELECT count(*) FROM graph.follows
          WHERE follower_id = $1 OR followee_id = $1) +
         (SELECT count(*) FROM graph.blocks
          WHERE blocker_id = $1 OR blocked_id = $1) +
         (SELECT count(*) FROM graph.mutes
          WHERE muter_id = $1 OR muted_id = $1)
       )::text AS c`,
      [userId],
    );
    return Number(r.rows[0]?.c ?? 0);
  }
}

export function startCascadeWorker(options: {
  service: CascadeService;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 2_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      // Drain a few jobs/batches per wake
      for (let i = 0; i < 5; i++) {
        const worked = await options.service.runOnce();
        if (!worked) break;
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

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
