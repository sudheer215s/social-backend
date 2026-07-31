import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';

export interface ReconcileResult {
  scanned: number;
  fixed: number;
}

/**
 * Repair denormalised counters from graph/post source tables.
 * Assumes co-located schemas (local compose / shared Postgres).
 * In multi-DB prod this becomes an RPC-fed reconcilers; same math.
 */
@Injectable()
export class CounterReconcileService {
  private readonly log = new Logger(CounterReconcileService.name);

  constructor(private readonly pool: Pool) {}

  async reconcileBatch(limit = 200): Promise<ReconcileResult> {
    // Sample active users with potentially stale counters
    const users = await this.pool.query<{ id: string }>(
      `SELECT id FROM identity.users
       WHERE status IN ('active', 'deactivated')
       ORDER BY updated_at
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 1000)],
    );

    let fixed = 0;
    for (const u of users.rows) {
      try {
        const ok = await this.reconcileUser(u.id);
        if (ok) fixed += 1;
      } catch (err) {
        this.log.warn(`reconcile failed ${u.id}: ${String(err)}`);
      }
    }
    return { scanned: users.rows.length, fixed };
  }

  async reconcileUser(userId: string): Promise<boolean> {
    // Graph + post tables may not exist in isolated identity-only DB — catch and skip
    const stats = await this.pool.query<{
      followers: string;
      following: string;
      posts: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM graph.follows WHERE followee_id = $1::uuid) AS followers,
         (SELECT count(*)::text FROM graph.follows WHERE follower_id = $1::uuid) AS following,
         (SELECT count(*)::text FROM post.posts
            WHERE author_id = $1::uuid AND deleted_at IS NULL AND reply_to_id IS NULL) AS posts`,
      [userId],
    );
    const row = stats.rows[0];
    if (!row) return false;
    const followers = Number(row.followers);
    const following = Number(row.following);
    const posts = Number(row.posts);

    const updated = await this.pool.query(
      `UPDATE identity.users
       SET follower_count = $2,
           following_count = $3,
           post_count = $4,
           updated_at = now()
       WHERE id = $1::uuid
         AND (
           follower_count IS DISTINCT FROM $2
           OR following_count IS DISTINCT FROM $3
           OR post_count IS DISTINCT FROM $4
         )
       RETURNING id`,
      [userId, followers, following, posts],
    );
    return (updated.rowCount ?? 0) > 0;
  }
}

export function startCounterReconcile(options: {
  service: CounterReconcileService;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const r = await options.service.reconcileBatch(100);
      if (r.fixed > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[counter-reconcile] scanned=${r.scanned} fixed=${r.fixed}`,
        );
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
