import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { uuidv7 } from 'uuidv7';
import type { CreatePostInput } from './posts.validation';

export interface PostDto {
  id: string;
  authorId: string;
  content: string;
  mediaRefs: string[];
  replyToId: string | null;
  threadRootId: string | null;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  createdAt: Date;
}

@Injectable()
export class PostsService {
  constructor(private readonly pool: Pool) {}

  async create(authorId: string, input: CreatePostInput): Promise<PostDto> {
    const id = uuidv7();
    let threadRootId: string | null = null;
    const replyToId: string | null = input.replyToId ?? null;

    if (replyToId) {
      const parent = await this.pool.query<{
        id: string;
        thread_root_id: string | null;
        deleted_at: Date | null;
      }>(
        `SELECT id, thread_root_id, deleted_at FROM post.posts WHERE id = $1`,
        [replyToId],
      );
      const p = parent.rows[0];
      if (!p || p.deleted_at) {
        throw new NotFoundException('Parent post not found');
      }
      threadRootId = p.thread_root_id ?? p.id;
    }

    const mediaRefs = input.mediaRefs ?? [];
    const row = await this.pool.query(
      `INSERT INTO post.posts
         (id, author_id, content, media_refs, reply_to_id, thread_root_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, author_id, content, media_refs, reply_to_id, thread_root_id,
                 like_count, reply_count, repost_count, created_at`,
      [id, authorId, input.content, mediaRefs, replyToId, threadRootId],
    );

    if (replyToId) {
      await this.pool.query(
        `UPDATE post.posts SET reply_count = reply_count + 1
         WHERE id = $1 AND deleted_at IS NULL`,
        [replyToId],
      );
    }

    return mapPost(row.rows[0] as PostRow);
  }

  async getById(postId: string): Promise<PostDto> {
    const row = await this.pool.query(
      `SELECT id, author_id, content, media_refs, reply_to_id, thread_root_id,
              like_count, reply_count, repost_count, created_at
       FROM post.posts
       WHERE id = $1 AND deleted_at IS NULL`,
      [postId],
    );
    const p = row.rows[0] as PostRow | undefined;
    if (!p) throw new NotFoundException('Post not found');
    return mapPost(p);
  }

  async listByAuthor(authorId: string, limit = 20): Promise<PostDto[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.pool.query(
      `SELECT id, author_id, content, media_refs, reply_to_id, thread_root_id,
              like_count, reply_count, repost_count, created_at
       FROM post.posts
       WHERE author_id = $1 AND deleted_at IS NULL AND reply_to_id IS NULL
       ORDER BY id DESC
       LIMIT $2`,
      [authorId, safeLimit],
    );
    return (rows.rows as PostRow[]).map(mapPost);
  }

  async softDelete(postId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE post.posts
       SET deleted_at = now(), deleted_by = 'author'
       WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [postId, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      const exists = await this.pool.query(
        `SELECT author_id FROM post.posts WHERE id = $1`,
        [postId],
      );
      if ((exists.rowCount ?? 0) === 0) {
        throw new NotFoundException('Post not found');
      }
      throw new ForbiddenException('Not the author');
    }
  }

  async like(postId: string, userId: string): Promise<PostDto> {
    return withTransaction(this.pool, async (client) => {
      const post = await client.query(
        `SELECT id FROM post.posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [postId],
      );
      if ((post.rowCount ?? 0) === 0) {
        throw new NotFoundException('Post not found');
      }
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
      }
      const row = await client.query(
        `SELECT id, author_id, content, media_refs, reply_to_id, thread_root_id,
                like_count, reply_count, repost_count, created_at
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
        `SELECT id, author_id, content, media_refs, reply_to_id, thread_root_id,
                like_count, reply_count, repost_count, created_at
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
    likeCount: Number(row.like_count),
    replyCount: Number(row.reply_count),
    repostCount: Number(row.repost_count),
    createdAt: row.created_at,
  };
}
