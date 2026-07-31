import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';

const CONSUMER_GROUP = 'post-author-cascade';
const BATCH = 500;

/**
 * On user.erased: soft-delete the author's remaining posts in batches.
 * Emits no per-post outbox (volume); identity already zeroed/erased the profile.
 */
@Injectable()
export class AuthorCascadeService {
  private readonly log = new Logger(AuthorCascadeService.name);

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
        `INSERT INTO post.processed_events (consumer_group, event_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [CONSUMER_GROUP, input.eventId],
      );
      if ((dedupe.rowCount ?? 0) === 0) {
        return 'duplicate';
      }

      // Soft-delete all remaining posts for author (batched inside tx for small accounts;
      // large accounts continue outside).
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const r = await client.query(
          `UPDATE post.posts
           SET deleted_at = coalesce(deleted_at, now()),
               deleted_by = coalesce(deleted_by, 'erasure')
           WHERE id IN (
             SELECT id FROM post.posts
             WHERE author_id = $1::uuid AND deleted_at IS NULL
             LIMIT $2
           )`,
          [userId, BATCH],
        );
        const n = r.rowCount ?? 0;
        total += n;
        if (n < BATCH) break;
      }
      this.log.log(`author cascade soft-deleted ${total} posts for ${userId}`);
      return 'handled';
    });
  }

  /** Continue soft-delete if a prior run left leftovers (idempotent safety). */
  async drainAuthor(userId: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const r = await this.pool.query(
        `UPDATE post.posts
         SET deleted_at = coalesce(deleted_at, now()),
             deleted_by = coalesce(deleted_by, 'erasure')
         WHERE id IN (
           SELECT id FROM post.posts
           WHERE author_id = $1::uuid AND deleted_at IS NULL
           LIMIT $2
         )`,
        [userId, BATCH],
      );
      const n = r.rowCount ?? 0;
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
