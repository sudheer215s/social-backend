import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';

const CONSUMER_GROUP = 'identity-counters';

/**
 * Adjust denormalised follower/following counts from graph events.
 * Dedupe via processed_events so at-least-once Kafka is safe.
 */
@Injectable()
export class CounterService {
  constructor(private readonly pool: Pool) {}

  async processDomainEvent(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<'handled' | 'duplicate' | 'skipped'> {
    if (
      input.eventType !== 'user.followed' &&
      input.eventType !== 'user.unfollowed'
    ) {
      return 'skipped';
    }
    const followerId = asString(input.payload.followerId);
    const followeeId = asString(input.payload.followeeId);
    if (!followerId || !followeeId) return 'skipped';

    const delta = input.eventType === 'user.followed' ? 1 : -1;

    return withTransaction(this.pool, async (client) => {
      const dedupe = await client.query(
        `INSERT INTO identity.processed_events (consumer_group, event_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [CONSUMER_GROUP, input.eventId],
      );
      if ((dedupe.rowCount ?? 0) === 0) {
        return 'duplicate';
      }

      if (delta > 0) {
        await client.query(
          `UPDATE identity.users
           SET following_count = following_count + 1, updated_at = now()
           WHERE id = $1::uuid AND status <> 'erased'`,
          [followerId],
        );
        await client.query(
          `UPDATE identity.users
           SET follower_count = follower_count + 1, updated_at = now()
           WHERE id = $1::uuid AND status <> 'erased'`,
          [followeeId],
        );
      } else {
        await client.query(
          `UPDATE identity.users
           SET following_count = GREATEST(following_count - 1, 0),
               updated_at = now()
           WHERE id = $1::uuid AND status <> 'erased'`,
          [followerId],
        );
        await client.query(
          `UPDATE identity.users
           SET follower_count = GREATEST(follower_count - 1, 0),
               updated_at = now()
           WHERE id = $1::uuid AND status <> 'erased'`,
          [followeeId],
        );
      }
      return 'handled';
    });
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
