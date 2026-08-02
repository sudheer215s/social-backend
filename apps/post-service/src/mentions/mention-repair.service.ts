import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';
import { POST_TOPIC } from '../posts/posts.service';

/**
 * Resolves mentions left unresolved when identity was down at write time.
 * Design: run about every 15 minutes; safe to call more often.
 */
@Injectable()
export class MentionRepairService {
  private readonly log = new Logger(MentionRepairService.name);
  private readonly identityBaseUrl: string;

  constructor(private readonly pool: Pool) {
    this.identityBaseUrl =
      process.env.IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001';
  }

  async repairBatch(limit = 100): Promise<{ scanned: number; resolved: number }> {
    const rows = await this.pool.query<{
      post_id: string;
      raw_username: string;
    }>(
      `SELECT post_id, raw_username FROM post.mentions
       WHERE mentioned_user_id IS NULL
       ORDER BY post_id, raw_username
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );

    let resolved = 0;
    for (const row of rows.rows) {
      const userId = await this.resolveUsername(row.raw_username);
      if (!userId) continue;

      const did = await withTransaction(this.pool, async (client) => {
        const upd = await client.query(
          `UPDATE post.mentions
           SET mentioned_user_id = $3, resolved_at = now()
           WHERE post_id = $1 AND raw_username = $2
             AND mentioned_user_id IS NULL
           RETURNING post_id`,
          [row.post_id, row.raw_username, userId],
        );
        if ((upd.rowCount ?? 0) === 0) return false;

        const post = await client.query<{ author_id: string }>(
          `SELECT author_id FROM post.posts WHERE id = $1`,
          [row.post_id],
        );
        const authorId = post.rows[0]?.author_id;
        if (authorId && authorId !== userId) {
          await appendOutbox(client, 'post', {
            aggregateType: 'post',
            aggregateId: row.post_id,
            eventType: 'user.mentioned',
            partitionKey: userId,
            topic: POST_TOPIC,
            payload: {
              postId: row.post_id,
              authorId,
              mentionedUserId: userId,
              username: row.raw_username,
              repaired: true,
            },
          });
        }
        return true;
      });
      if (did) resolved += 1;
    }

    if (rows.rows.length > 0) {
      this.log.log(
        `mention-repair scanned=${rows.rows.length} resolved=${resolved}`,
      );
    }
    return { scanned: rows.rows.length, resolved };
  }

  private async resolveUsername(username: string): Promise<string | null> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 500);
      const res = await fetch(
        `${this.identityBaseUrl}/v1/users/by-username/${encodeURIComponent(username)}`,
        { signal: ac.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = (await res.json()) as { user?: { id?: string } };
      return typeof json.user?.id === 'string' ? json.user.id : null;
    } catch {
      return null;
    }
  }
}
