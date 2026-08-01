import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';
import { uuidv7 } from 'uuidv7';
import type { CreatePostInput } from './posts.validation';

export const POST_TOPIC = 'social.post.v1';

export interface PostDto {
  id: string;
  authorId: string;
  content: string;
  mediaRefs: string[];
  replyToId: string | null;
  threadRootId: string | null;
  repostOfId: string | null;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  createdAt: Date;
}

const POST_SELECT = `id, author_id, content, media_refs, reply_to_id, thread_root_id,
              repost_of_id, like_count, reply_count, repost_count, created_at`;

@Injectable()
export class PostsService {
  constructor(private readonly pool: Pool) {}

  async create(authorId: string, input: CreatePostInput): Promise<PostDto> {
    const id = uuidv7();
    let threadRootId: string | null = null;
    const replyToId: string | null = input.replyToId ?? null;
    let repostOfId: string | null = input.repostOfId ?? null;
    let parentAuthorId: string | null = null;
    let originalAuthorId: string | null = null;
    const content = input.content ?? '';
    const mediaRefs = input.mediaRefs ?? [];
    const isPureRepost = !!repostOfId && content.length === 0;

    return withTransaction(this.pool, async (client) => {
      if (replyToId) {
        // Design: reply to deleted is allowed (thread shows a tombstone for parent).
        const parent = await client.query<{
          id: string;
          author_id: string;
          thread_root_id: string | null;
        }>(
          `SELECT id, author_id, thread_root_id FROM post.posts WHERE id = $1`,
          [replyToId],
        );
        const p = parent.rows[0];
        if (!p) {
          throw new NotFoundException('Parent post not found');
        }
        parentAuthorId = p.author_id;
        threadRootId = p.thread_root_id ?? p.id;
      }

      if (repostOfId) {
        const original = await this.resolveRepostTarget(client, repostOfId);
        repostOfId = original.id;
        originalAuthorId = original.author_id;
      }

      let row;
      try {
        row = await client.query(
          `INSERT INTO post.posts
             (id, author_id, content, media_refs, reply_to_id, thread_root_id, repost_of_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${POST_SELECT}`,
          [
            id,
            authorId,
            content,
            mediaRefs,
            replyToId,
            threadRootId,
            repostOfId,
          ],
        );
      } catch (err: unknown) {
        // Unique pure-repost per author
        if (
          isPureRepost &&
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code?: string }).code === '23505'
        ) {
          const existing = await client.query(
            `SELECT ${POST_SELECT} FROM post.posts
             WHERE author_id = $1 AND repost_of_id = $2
               AND content = '' AND deleted_at IS NULL
             LIMIT 1`,
            [authorId, repostOfId],
          );
          if (existing.rows[0]) {
            throw new ConflictException('Already reposted');
          }
        }
        throw err;
      }

      if (replyToId) {
        await client.query(
          `UPDATE post.posts SET reply_count = reply_count + 1
           WHERE id = $1 AND deleted_at IS NULL`,
          [replyToId],
        );
      }

      if (repostOfId) {
        await client.query(
          `UPDATE post.posts SET repost_count = repost_count + 1
           WHERE id = $1 AND deleted_at IS NULL`,
          [repostOfId],
        );
      }

      const post = mapPost(row.rows[0] as PostRow);

      // Home-timeline fan-out: top-level originals and reposts (not replies).
      if (!replyToId) {
        await appendOutbox(client, 'post', {
          aggregateType: 'post',
          aggregateId: post.id,
          eventType: 'post.created',
          partitionKey: post.authorId,
          topic: POST_TOPIC,
          payload: {
            postId: post.id,
            authorId: post.authorId,
            content: post.content,
            repostOfId: post.repostOfId,
            createdAt: post.createdAt.toISOString(),
          },
        });
      }

      if (replyToId && parentAuthorId) {
        await appendOutbox(client, 'post', {
          aggregateType: 'post',
          aggregateId: post.id,
          eventType: 'post.replied',
          partitionKey: parentAuthorId,
          topic: POST_TOPIC,
          payload: {
            postId: post.id,
            authorId: post.authorId,
            parentPostId: replyToId,
            parentAuthorId,
            threadRootId: post.threadRootId,
            content: post.content,
            createdAt: post.createdAt.toISOString(),
          },
        });
      }

      if (repostOfId && originalAuthorId) {
        await appendOutbox(client, 'post', {
          aggregateType: 'post',
          aggregateId: post.id,
          eventType: 'post.reposted',
          partitionKey: originalAuthorId,
          topic: POST_TOPIC,
          payload: {
            postId: post.id,
            authorId: post.authorId,
            originalPostId: repostOfId,
            originalAuthorId,
            content: post.content,
            createdAt: post.createdAt.toISOString(),
          },
        });
      }

      return post;
    });
  }

  /**
   * Repost of a repost collapses to the root content post.
   * Deleted originals are rejected (nothing durable to attach to).
   */
  private async resolveRepostTarget(
    client: PoolClient,
    repostOfId: string,
  ): Promise<{ id: string; author_id: string }> {
    const row = await client.query<{
      id: string;
      author_id: string;
      repost_of_id: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT id, author_id, repost_of_id, deleted_at FROM post.posts WHERE id = $1`,
      [repostOfId],
    );
    const p = row.rows[0];
    if (!p || p.deleted_at) {
      throw new NotFoundException('Original post not found');
    }
    if (p.repost_of_id) {
      const root = await client.query<{
        id: string;
        author_id: string;
        deleted_at: Date | null;
      }>(`SELECT id, author_id, deleted_at FROM post.posts WHERE id = $1`, [
        p.repost_of_id,
      ]);
      const r = root.rows[0];
      if (!r || r.deleted_at) {
        throw new NotFoundException('Original post not found');
      }
      return { id: r.id, author_id: r.author_id };
    }
    return { id: p.id, author_id: p.author_id };
  }

  async getById(postId: string): Promise<PostDto> {
    const row = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE id = $1 AND deleted_at IS NULL`,
      [postId],
    );
    const p = row.rows[0] as PostRow | undefined;
    if (!p) throw new NotFoundException('Post not found');
    return mapPost(p);
  }

  async getByIds(ids: string[]): Promise<PostDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    const byId = new Map(
      (rows.rows as PostRow[]).map((r) => [r.id, mapPost(r)]),
    );
    return ids.map((id) => byId.get(id)).filter((p): p is PostDto => !!p);
  }

  async listByAuthor(authorId: string, limit = 20): Promise<PostDto[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE author_id = $1 AND deleted_at IS NULL AND reply_to_id IS NULL
       ORDER BY id DESC
       LIMIT $2`,
      [authorId, safeLimit],
    );
    return (rows.rows as PostRow[]).map(mapPost);
  }

  /** Direct replies to a post (one level). */
  async listReplies(parentId: string, limit = 50): Promise<PostDto[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE reply_to_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT $2`,
      [parentId, safeLimit],
    );
    return (rows.rows as PostRow[]).map(mapPost);
  }

  /**
   * Thread page: root (if live) + posts with thread_root_id = root, ordered by id.
   * `rootId` may be the root or any reply in the thread.
   */
  async getThread(
    rootOrPostId: string,
    limit = 50,
  ): Promise<{ root: PostDto | null; posts: PostDto[] }> {
    const anchor = await this.pool.query<{
      id: string;
      thread_root_id: string | null;
      deleted_at: Date | null;
    }>(`SELECT id, thread_root_id, deleted_at FROM post.posts WHERE id = $1`, [
      rootOrPostId,
    ]);
    const a = anchor.rows[0];
    if (!a) throw new NotFoundException('Post not found');
    const rootId = a.thread_root_id ?? a.id;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const rootRow = await this.pool.query(
      `SELECT ${POST_SELECT} FROM post.posts
       WHERE id = $1 AND deleted_at IS NULL`,
      [rootId],
    );
    const root = rootRow.rows[0] ? mapPost(rootRow.rows[0] as PostRow) : null;

    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE deleted_at IS NULL
         AND (id = $1 OR thread_root_id = $1)
       ORDER BY id ASC
       LIMIT $2`,
      [rootId, safeLimit],
    );
    return {
      root,
      posts: (rows.rows as PostRow[]).map(mapPost),
    };
  }

  async softDelete(postId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        author_id: string;
        reply_to_id: string | null;
        repost_of_id: string | null;
      }>(
        `UPDATE post.posts
         SET deleted_at = now(), deleted_by = 'author'
         WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
         RETURNING id, author_id, reply_to_id, repost_of_id`,
        [postId, userId],
      );
      if ((result.rowCount ?? 0) === 0) {
        const exists = await client.query(
          `SELECT author_id FROM post.posts WHERE id = $1`,
          [postId],
        );
        if ((exists.rowCount ?? 0) === 0) {
          throw new NotFoundException('Post not found');
        }
        throw new ForbiddenException('Not the author');
      }
      const row = result.rows[0]!;
      if (row.reply_to_id) {
        await client.query(
          `UPDATE post.posts
           SET reply_count = GREATEST(reply_count - 1, 0)
           WHERE id = $1`,
          [row.reply_to_id],
        );
      }
      if (row.repost_of_id) {
        await client.query(
          `UPDATE post.posts
           SET repost_count = GREATEST(repost_count - 1, 0)
           WHERE id = $1`,
          [row.repost_of_id],
        );
      }
      await appendOutbox(client, 'post', {
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'post.deleted',
        partitionKey: row.author_id,
        topic: POST_TOPIC,
        payload: {
          postId,
          authorId: row.author_id,
        },
      });
    });
  }

  async like(postId: string, userId: string): Promise<PostDto> {
    return withTransaction(this.pool, async (client) => {
      const post = await client.query<{ id: string; author_id: string }>(
        `SELECT id, author_id FROM post.posts
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [postId],
      );
      if ((post.rowCount ?? 0) === 0) {
        throw new NotFoundException('Post not found');
      }
      const authorId = post.rows[0]!.author_id;
      const inserted = await client.query(
        `INSERT INTO post.likes (post_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING post_id`,
        [postId, userId],
      );
      if ((inserted.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE post.posts SET like_count = like_count + 1 WHERE id = $1`,
          [postId],
        );
        await appendOutbox(client, 'post', {
          aggregateType: 'post',
          aggregateId: postId,
          eventType: 'post.liked',
          partitionKey: authorId,
          topic: POST_TOPIC,
          payload: {
            postId,
            authorId,
            userId,
          },
        });
      }
      const row = await client.query(
        `SELECT ${POST_SELECT}
         FROM post.posts WHERE id = $1`,
        [postId],
      );
      return mapPost(row.rows[0] as PostRow);
    });
  }

  async unlike(postId: string, userId: string): Promise<PostDto> {
    return withTransaction(this.pool, async (client) => {
      const deleted = await client.query(
        `DELETE FROM post.likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
        [postId, userId],
      );
      if ((deleted.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE post.posts
           SET like_count = GREATEST(like_count - 1, 0)
           WHERE id = $1`,
          [postId],
        );
      }
      const row = await client.query(
        `SELECT ${POST_SELECT}
         FROM post.posts WHERE id = $1 AND deleted_at IS NULL`,
        [postId],
      );
      const p = row.rows[0] as PostRow | undefined;
      if (!p) throw new NotFoundException('Post not found');
      return mapPost(p);
    });
  }
}

interface PostRow {
  id: string;
  author_id: string;
  content: string;
  media_refs: string[];
  reply_to_id: string | null;
  thread_root_id: string | null;
  repost_of_id: string | null;
  like_count: string | number;
  reply_count: string | number;
  repost_count: string | number;
  created_at: Date;
}

function mapPost(row: PostRow): PostDto {
  return {
    id: row.id,
    authorId: row.author_id,
    content: row.content,
    mediaRefs: row.media_refs ?? [],
    replyToId: row.reply_to_id,
    threadRootId: row.thread_root_id,
    repostOfId: row.repost_of_id,
    likeCount: Number(row.like_count),
    replyCount: Number(row.reply_count),
    repostCount: Number(row.repost_count),
    createdAt: row.created_at,
  };
}
