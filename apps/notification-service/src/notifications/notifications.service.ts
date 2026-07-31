import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import type { RedisClient } from '@social/platform-redis';
import { uuidv7 } from 'uuidv7';
import { publishNotificationPointer } from './delivery-stream';

const GROUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ACTOR_CAP = 8;
const CONSUMER_GROUP = 'notification-processor';

export type NotifType = 'follow' | 'like' | 'reply' | 'mention' | 'repost';

export interface NotificationDto {
  id: string;
  userId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  actorIds: string[];
  actorCount: number;
  groupKey: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly pool: Pool,
    private readonly redis: RedisClient | null = null,
  ) {}

  async processDomainEvent(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<'handled' | 'duplicate' | 'skipped'> {
    const mapped = mapEvent(input.eventType, input.payload);
    if (!mapped) return 'skipped';

    const outcome = await withTransaction(this.pool, async (client) => {
      const dedupe = await client.query(
        `INSERT INTO notification.processed_events (consumer_group, event_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [CONSUMER_GROUP, input.eventId],
      );
      if ((dedupe.rowCount ?? 0) === 0) {
        return { status: 'duplicate' as const };
      }

      if (mapped.actorId === mapped.recipientId) {
        return { status: 'skipped' as const };
      }

      const groupWindow = Math.floor(Date.now() / GROUP_WINDOW_MS);
      const id = uuidv7();

      // Upsert aggregation group; RETURNING yields the live row id
      const upsert = await client.query<{ id: string; type: string }>(
        `INSERT INTO notification.notifications
           (id, user_id, type, entity_type, entity_id, actor_ids, actor_count,
            group_key, group_window, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::uuid, ARRAY[$6::uuid], 1, $7, $8, now(), now())
         ON CONFLICT (user_id, group_key, group_window)
         DO UPDATE SET
           actor_ids = (
             SELECT ARRAY(
               SELECT x FROM unnest(
                 ARRAY[$6::uuid] || notification.notifications.actor_ids
               ) AS x
               LIMIT ${ACTOR_CAP}
             )
           ),
           actor_count = notification.notifications.actor_count + 1,
           is_read = false,
           updated_at = now()
         RETURNING id, type`,
        [
          id,
          mapped.recipientId,
          mapped.type,
          mapped.entityType,
          mapped.entityId,
          mapped.actorId,
          mapped.groupKey,
          groupWindow,
        ],
      );
      const row = upsert.rows[0];
      return {
        status: 'handled' as const,
        userId: mapped.recipientId,
        notificationId: row?.id ?? id,
        type: row?.type ?? mapped.type,
      };
    });

    if (outcome.status === 'handled' && this.redis) {
      try {
        await publishNotificationPointer(this.redis, {
          userId: outcome.userId,
          notificationId: outcome.notificationId,
          type: outcome.type,
        });
      } catch (err) {
        // Realtime is best-effort; durable row is already committed.
        this.log.warn(`stream publish failed: ${String(err)}`);
      }
    }

    return outcome.status;
  }

  async listForUser(userId: string, limit = 30): Promise<NotificationDto[]> {
    const rows = await this.pool.query(
      `SELECT id, user_id, type, entity_type, entity_id, actor_ids, actor_count,
              group_key, is_read, created_at, updated_at
       FROM notification.notifications
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return (rows.rows as NotifRow[]).map(mapRow);
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM notification.notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId],
    );
    return Number(r.rows[0]?.c ?? 0);
  }

  async markRead(userId: string, ids?: string[]): Promise<number> {
    if (ids && ids.length > 0) {
      const r = await this.pool.query(
        `UPDATE notification.notifications
         SET is_read = true, updated_at = now()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = false`,
        [userId, ids],
      );
      return r.rowCount ?? 0;
    }
    const r = await this.pool.query(
      `UPDATE notification.notifications
       SET is_read = true, updated_at = now()
       WHERE user_id = $1 AND is_read = false`,
      [userId],
    );
    return r.rowCount ?? 0;
  }

  async getByIds(userId: string, ids: string[]): Promise<NotificationDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.pool.query(
      `SELECT id, user_id, type, entity_type, entity_id, actor_ids, actor_count,
              group_key, is_read, created_at, updated_at
       FROM notification.notifications
       WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids.slice(0, 100)],
    );
    return (rows.rows as NotifRow[]).map(mapRow);
  }
}

function mapEvent(
  eventType: string,
  payload: Record<string, unknown>,
): {
  type: NotifType;
  recipientId: string;
  actorId: string;
  entityType: string | null;
  entityId: string | null;
  groupKey: string;
} | null {
  if (eventType === 'user.followed') {
    const followerId = asString(payload.followerId);
    const followeeId = asString(payload.followeeId);
    if (!followerId || !followeeId) return null;
    return {
      type: 'follow',
      recipientId: followeeId,
      actorId: followerId,
      entityType: 'user',
      entityId: followerId,
      groupKey: 'follow',
    };
  }
  if (eventType === 'post.liked') {
    const postId = asString(payload.postId);
    const authorId = asString(payload.authorId);
    const likerId = asString(payload.userId);
    if (!postId || !authorId || !likerId) return null;
    return {
      type: 'like',
      recipientId: authorId,
      actorId: likerId,
      entityType: 'post',
      entityId: postId,
      groupKey: `like:${postId}`,
    };
  }
  return null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

interface NotifRow {
  id: string;
  user_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_ids: string[];
  actor_count: number;
  group_key: string;
  is_read: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: NotifRow): NotificationDto {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorIds: r.actor_ids ?? [],
    actorCount: r.actor_count,
    groupKey: r.group_key,
    isRead: r.is_read,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
