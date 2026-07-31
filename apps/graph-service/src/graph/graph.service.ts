import { BadRequestException, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';

@Injectable()
export class GraphService {
  constructor(private readonly pool: Pool) {}

  async follow(followerId: string, followeeId: string): Promise<void> {
    if (followerId === followeeId) {
      throw new BadRequestException('Cannot follow yourself');
    }
    await withTransaction(this.pool, async (client) => {
      const blocked = await client.query(
        `SELECT 1 FROM graph.blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [followerId, followeeId],
      );
      if ((blocked.rowCount ?? 0) > 0) {
        throw new BadRequestException('Cannot follow due to block');
      }
      await client.query(
        `INSERT INTO graph.follows (follower_id, followee_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [followerId, followeeId],
      );
    });
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM graph.follows
       WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
    );
  }

  async listFollowing(
    userId: string,
    limit = 50,
  ): Promise<{ userId: string; createdAt: Date }[]> {
    const rows = await this.pool.query<{
      followee_id: string;
      created_at: Date;
    }>(
      `SELECT followee_id, created_at FROM graph.follows
       WHERE follower_id = $1
       ORDER BY created_at DESC, followee_id
       LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.rows.map((r) => ({
      userId: r.followee_id,
      createdAt: r.created_at,
    }));
  }

  async listFollowers(
    userId: string,
    limit = 50,
  ): Promise<{ userId: string; createdAt: Date }[]> {
    const rows = await this.pool.query<{
      follower_id: string;
      created_at: Date;
    }>(
      `SELECT follower_id, created_at FROM graph.follows
       WHERE followee_id = $1
       ORDER BY created_at DESC, follower_id
       LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.rows.map((r) => ({
      userId: r.follower_id,
      createdAt: r.created_at,
    }));
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO graph.blocks (blocker_id, blocked_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [blockerId, blockedId],
      );
      // Sever follows both ways
      await client.query(
        `DELETE FROM graph.follows
         WHERE (follower_id = $1 AND followee_id = $2)
            OR (follower_id = $2 AND followee_id = $1)`,
        [blockerId, blockedId],
      );
    });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM graph.blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    );
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM graph.follows
       WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
