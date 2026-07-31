import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';
import { USER_TOPIC } from '../users/user-events';

/**
 * Hard-erase accounts whose deactivate grace period has elapsed.
 * Scrubs PII, marks status=erased, emits user.erased for downstream cleanup.
 */
@Injectable()
export class ErasureWorker {
  private readonly log = new Logger(ErasureWorker.name);

  constructor(private readonly pool: Pool) {}

  /**
   * Process up to `limit` accounts ready for erasure.
   * @returns number erased
   */
  async runOnce(limit = 50): Promise<number> {
    const due = await this.pool.query<{ id: string }>(
      `SELECT id FROM identity.users
       WHERE status = 'deactivated'
         AND erase_after IS NOT NULL
         AND erase_after <= now()
       ORDER BY erase_after
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
    let erased = 0;
    for (const row of due.rows) {
      try {
        if (await this.eraseOne(row.id)) {
          erased += 1;
        }
      } catch (err) {
        this.log.error(`erase failed for ${row.id}: ${String(err)}`);
      }
    }
    return erased;
  }

  async eraseOne(userId: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const claimed = await client.query<{ id: string }>(
        `SELECT id FROM identity.users
         WHERE id = $1::uuid
           AND status = 'deactivated'
           AND erase_after IS NOT NULL
           AND erase_after <= now()
         FOR UPDATE`,
        [userId],
      );
      if ((claimed.rowCount ?? 0) === 0) {
        return false;
      }

      // Scrub PII; keep id for foreign-key stability elsewhere.
      // Email/username freed by renaming to non-colliding tombstones.
      const tombEmail = `erased+${userId.replace(/-/g, '')}@invalid.local`;
      const tombUser = `erased_${userId.replace(/-/g, '').slice(0, 20)}`;
      await client.query(
        `UPDATE identity.users
         SET status = 'erased',
             email = $2,
             username = $3,
             display_name = NULL,
             bio = NULL,
             avatar_media_id = NULL,
             email_verified = false,
             updated_at = now()
         WHERE id = $1::uuid`,
        [userId, tombEmail, tombUser],
      );

      await client.query(
        `DELETE FROM identity.credentials WHERE user_id = $1::uuid`,
        [userId],
      );
      await client.query(
        `UPDATE identity.sessions
         SET revoked_at = coalesce(revoked_at, now())
         WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [userId],
      );
      await client.query(
        `DELETE FROM identity.email_tokens WHERE user_id = $1::uuid`,
        [userId],
      );

      await appendOutbox(client, 'identity', {
        aggregateType: 'user',
        aggregateId: userId,
        eventType: 'user.erased',
        partitionKey: userId,
        topic: USER_TOPIC,
        payload: { userId, status: 'erased' },
      });

      return true;
    });
  }
}

export function startErasureWorker(options: {
  worker: ErasureWorker;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await options.worker.runOnce();
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
