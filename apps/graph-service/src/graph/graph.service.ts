import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  decodeCursor,
  paginateRows,
  type PageMeta,
  withTransaction,
} from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';

export const GRAPH_TOPIC = 'social.graph.v1';

export type FollowState = 'following' | 'requested' | 'unchanged';

export interface FollowResult {
  state: FollowState;
  changed: boolean;
}

@Injectable()
export class GraphService {
  private readonly identityBaseUrl: string;

  constructor(private readonly pool: Pool) {
    this.identityBaseUrl =
      process.env.IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001';
  }

  /**
   * Public follow → insert follows.
   * Private (visibility=followers) → insert follow_requests + follow.requested event.
   */
  async follow(followerId: string, followeeId: string): Promise<FollowResult> {
    if (followerId === followeeId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const target = await this.fetchTargetUser(followeeId);
    if (!target || target.status !== 'active') {
      throw new NotFoundException('User not found');
    }

    return withTransaction(this.pool, async (client) => {
      const blocked = await client.query(
        `SELECT 1 FROM graph.blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [followerId, followeeId],
      );
      // 404 not 403: must not reveal the block (design)
      if ((blocked.rowCount ?? 0) > 0) {
        throw new NotFoundException('User not found');
      }

      // Already following
      const existing = await client.query(
        `SELECT 1 FROM graph.follows
         WHERE follower_id = $1 AND followee_id = $2`,
        [followerId, followeeId],
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { state: 'following' as const, changed: false };
      }

      if (target.visibility === 'followers') {
        const reqIns = await client.query(
          `INSERT INTO graph.follow_requests (requester_id, target_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING requester_id`,
          [followerId, followeeId],
        );
        const changed = (reqIns.rowCount ?? 0) > 0;
        if (changed) {
          await appendOutbox(client, 'graph', {
            aggregateType: 'follow_request',
            aggregateId: `${followerId}:${followeeId}`,
            eventType: 'follow.requested',
            partitionKey: followeeId,
            topic: GRAPH_TOPIC,
            payload: { requesterId: followerId, targetId: followeeId },
          });
        }
        return { state: 'requested' as const, changed };
      }

      const inserted = await client.query(
        `INSERT INTO graph.follows (follower_id, followee_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING follower_id`,
        [followerId, followeeId],
      );
      const changed = (inserted.rowCount ?? 0) > 0;
      if (changed) {
        await this.emitFollowed(client, followerId, followeeId);
      }
      // Drop any stale request
      await client.query(
        `DELETE FROM graph.follow_requests
         WHERE requester_id = $1 AND target_id = $2`,
        [followerId, followeeId],
      );
      return { state: 'following' as const, changed };
    });
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const deleted = await client.query(
        `DELETE FROM graph.follows
         WHERE follower_id = $1 AND followee_id = $2
         RETURNING follower_id`,
        [followerId, followeeId],
      );
      if ((deleted.rowCount ?? 0) > 0) {
        await appendOutbox(client, 'graph', {
          aggregateType: 'follow',
          aggregateId: `${followerId}:${followeeId}`,
          eventType: 'user.unfollowed',
          partitionKey: followeeId,
          topic: GRAPH_TOPIC,
          payload: { followerId, followeeId },
        });
      }
      // Cancel pending request either way
      await client.query(
        `DELETE FROM graph.follow_requests
         WHERE requester_id = $1 AND target_id = $2`,
        [followerId, followeeId],
      );
    });
  }

  /** Target accepts a pending request → follows + user.followed */
  async acceptFollowRequest(
    targetId: string,
    requesterId: string,
  ): Promise<FollowResult> {
    return withTransaction(this.pool, async (client) => {
      const del = await client.query(
        `DELETE FROM graph.follow_requests
         WHERE requester_id = $1 AND target_id = $2
         RETURNING requester_id`,
        [requesterId, targetId],
      );
      if ((del.rowCount ?? 0) === 0) {
        // Already following counts as success
        const existing = await client.query(
          `SELECT 1 FROM graph.follows
           WHERE follower_id = $1 AND followee_id = $2`,
          [requesterId, targetId],
        );
        if ((existing.rowCount ?? 0) > 0) {
          return { state: 'following' as const, changed: false };
        }
        throw new NotFoundException('Follow request not found');
      }
      const blocked = await client.query(
        `SELECT 1 FROM graph.blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [requesterId, targetId],
      );
      if ((blocked.rowCount ?? 0) > 0) {
        throw new NotFoundException('User not found');
      }
      await client.query(
        `INSERT INTO graph.follows (follower_id, followee_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [requesterId, targetId],
      );
      await this.emitFollowed(client, requesterId, targetId);
      return { state: 'following' as const, changed: true };
    });
  }

  /** Silently drop request (requester not notified). */
  async rejectFollowRequest(
    targetId: string,
    requesterId: string,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM graph.follow_requests
       WHERE requester_id = $1 AND target_id = $2`,
      [requesterId, targetId],
    );
  }

  async listIncomingRequests(
    targetId: string,
    limit = 50,
  ): Promise<{ userId: string; createdAt: Date }[]> {
    const rows = await this.pool.query<{
      requester_id: string;
      created_at: Date;
    }>(
      `SELECT requester_id, created_at FROM graph.follow_requests
       WHERE target_id = $1
       ORDER BY created_at DESC, requester_id
       LIMIT $2`,
      [targetId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.rows.map((r) => ({
      userId: r.requester_id,
      createdAt: r.created_at,
    }));
  }

  private async emitFollowed(
    client: PoolClient,
    followerId: string,
    followeeId: string,
  ): Promise<void> {
    await appendOutbox(client, 'graph', {
      aggregateType: 'follow',
      aggregateId: `${followerId}:${followeeId}`,
      eventType: 'user.followed',
      partitionKey: followeeId,
      topic: GRAPH_TOPIC,
      payload: { followerId, followeeId },
    });
  }

  private async fetchTargetUser(
    userId: string,
  ): Promise<{ visibility: string; status: string } | null> {
    try {
      const res = await fetch(
        `${this.identityBaseUrl}/v1/users/${encodeURIComponent(userId)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        // Fail open to public follow if identity is down (availability over privacy edge)
        return { visibility: 'public', status: 'active' };
      }
      const json = (await res.json()) as {
        user?: { visibility?: string; status?: string };
      };
      return {
        visibility: json.user?.visibility ?? 'public',
        status: json.user?.status ?? 'active',
      };
    } catch {
      return { visibility: 'public', status: 'active' };
    }
  }

  async listFollowing(
    userId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{
    items: { userId: string; createdAt: Date }[];
    page: PageMeta;
  }> {
    return this.listEdges('following', userId, limit, cursor);
  }

  async listFollowers(
    userId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{
    items: { userId: string; createdAt: Date }[];
    page: PageMeta;
  }> {
    return this.listEdges('followers', userId, limit, cursor);
  }

  private async listEdges(
    kind: 'following' | 'followers',
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    items: { userId: string; createdAt: Date }[];
    page: PageMeta;
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    let beforeCreatedAt: string | null = null;
    let beforeUserId: string | null = null;
    if (cursor) {
      try {
        const c = decodeCursor<{ createdAt?: string; userId?: string }>(cursor);
        beforeCreatedAt = typeof c.createdAt === 'string' ? c.createdAt : null;
        beforeUserId = typeof c.userId === 'string' ? c.userId : null;
        if (!beforeCreatedAt || !beforeUserId) {
          throw new Error('invalid_cursor');
        }
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const otherCol = kind === 'following' ? 'followee_id' : 'follower_id';
    const selfCol = kind === 'following' ? 'follower_id' : 'followee_id';
    const rows = await this.pool.query<{
      other_id: string;
      created_at: Date;
    }>(
      `SELECT ${otherCol} AS other_id, created_at FROM graph.follows
       WHERE ${selfCol} = $1
         AND (
           $2::timestamptz IS NULL
           OR (created_at, ${otherCol}) < ($2::timestamptz, $3::uuid)
         )
       ORDER BY created_at DESC, ${otherCol} DESC
       LIMIT $4`,
      [userId, beforeCreatedAt, beforeUserId, safeLimit + 1],
    );
    const mapped = rows.rows.map((r) => ({
      userId: r.other_id,
      createdAt: r.created_at,
    }));
    const { items, page } = paginateRows(mapped, safeLimit, (i) => ({
      userId: i.userId,
      createdAt: i.createdAt.toISOString(),
    }));
    return { items, page };
  }

  /** For fan-out: page follower IDs. */
  async listFollowerIds(followeeId: string, limit = 1000): Promise<string[]> {
    const rows = await this.pool.query<{ follower_id: string }>(
      `SELECT follower_id FROM graph.follows
       WHERE followee_id = $1
       ORDER BY follower_id
       LIMIT $2`,
      [followeeId, Math.min(Math.max(limit, 1), 5000)],
    );
    return rows.rows.map((r) => r.follower_id);
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }
    await withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO graph.blocks (blocker_id, blocked_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING blocker_id`,
        [blockerId, blockedId],
      );
      await client.query(
        `DELETE FROM graph.follows
         WHERE (follower_id = $1 AND followee_id = $2)
            OR (follower_id = $2 AND followee_id = $1)`,
        [blockerId, blockedId],
      );
      await client.query(
        `DELETE FROM graph.follow_requests
         WHERE (requester_id = $1 AND target_id = $2)
            OR (requester_id = $2 AND target_id = $1)`,
        [blockerId, blockedId],
      );
      if ((inserted.rowCount ?? 0) > 0) {
        await appendOutbox(client, 'graph', {
          aggregateType: 'block',
          aggregateId: `${blockerId}:${blockedId}`,
          eventType: 'user.blocked',
          partitionKey: blockedId,
          topic: GRAPH_TOPIC,
          payload: { blockerId, blockedId },
        });
      }
    });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const deleted = await client.query(
        `DELETE FROM graph.blocks
         WHERE blocker_id = $1 AND blocked_id = $2
         RETURNING blocker_id`,
        [blockerId, blockedId],
      );
      if ((deleted.rowCount ?? 0) > 0) {
        await appendOutbox(client, 'graph', {
          aggregateType: 'block',
          aggregateId: `${blockerId}:${blockedId}`,
          eventType: 'user.unblocked',
          partitionKey: blockedId,
          topic: GRAPH_TOPIC,
          payload: { blockerId, blockedId },
        });
      }
    });
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM graph.follows
       WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Users either side of a block with viewer — fail closed at hydration.
   */
  async listBlockedRelatedIds(userId: string): Promise<string[]> {
    const rows = await this.pool.query<{ other_id: string }>(
      `SELECT blocked_id AS other_id FROM graph.blocks WHERE blocker_id = $1
       UNION
       SELECT blocker_id AS other_id FROM graph.blocks WHERE blocked_id = $1`,
      [userId],
    );
    return rows.rows.map((r) => r.other_id);
  }

  async followerCount(userId: string): Promise<number> {
    const r = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM graph.follows WHERE followee_id = $1`,
      [userId],
    );
    return Number(r.rows[0]?.c ?? 0);
  }

  async mute(muterId: string, mutedId: string): Promise<void> {
    if (muterId === mutedId) {
      throw new BadRequestException('Cannot mute yourself');
    }
    await withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO graph.mutes (muter_id, muted_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING muter_id`,
        [muterId, mutedId],
      );
      if ((inserted.rowCount ?? 0) > 0) {
        await appendOutbox(client, 'graph', {
          aggregateType: 'mute',
          aggregateId: `${muterId}:${mutedId}`,
          eventType: 'user.muted',
          partitionKey: muterId,
          topic: GRAPH_TOPIC,
          payload: { muterId, mutedId },
        });
      }
    });
  }

  async unmute(muterId: string, mutedId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const deleted = await client.query(
        `DELETE FROM graph.mutes
         WHERE muter_id = $1 AND muted_id = $2
         RETURNING muter_id`,
        [muterId, mutedId],
      );
      if ((deleted.rowCount ?? 0) > 0) {
        await appendOutbox(client, 'graph', {
          aggregateType: 'mute',
          aggregateId: `${muterId}:${mutedId}`,
          eventType: 'user.unmuted',
          partitionKey: muterId,
          topic: GRAPH_TOPIC,
          payload: { muterId, mutedId },
        });
      }
    });
  }

  async listMutedIds(muterId: string): Promise<string[]> {
    const rows = await this.pool.query<{ muted_id: string }>(
      `SELECT muted_id FROM graph.mutes WHERE muter_id = $1`,
      [muterId],
    );
    return rows.rows.map((r) => r.muted_id);
  }

  /**
   * Whether notifications from actor → viewer should be suppressed
   * (block either direction, or viewer muted actor).
   */
  async shouldSuppressNotification(
    viewerId: string,
    actorId: string,
  ): Promise<boolean> {
    if (viewerId === actorId) return true;
    const r = await this.pool.query(
      `SELECT 1 WHERE EXISTS (
         SELECT 1 FROM graph.blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
       ) OR EXISTS (
         SELECT 1 FROM graph.mutes
         WHERE muter_id = $1 AND muted_id = $2
       )`,
      [viewerId, actorId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
