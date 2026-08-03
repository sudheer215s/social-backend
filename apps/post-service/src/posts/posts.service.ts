import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { uuidv7 } from 'uuidv7';
import type { CreatePostInput } from './posts.validation';
import { extractHashtags, extractMentions } from './text-extract';

export const POST_TOPIC = 'social.post.v1';

export interface MentionDto {
  username: string;
  userId: string | null;
}

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
  mentions?: MentionDto[];
  /** Present when a viewer id was supplied on the read path. */
  viewerLiked?: boolean;
  /** Present when a viewer id was supplied on the read path. */
  viewerReposted?: boolean;
}

export interface ViewerState {
  liked: boolean;
  reposted: boolean;
}

const POST_SELECT = `id, author_id, content, media_refs, reply_to_id, thread_root_id,
              repost_of_id, like_count, reply_count, repost_count, created_at`;

@Injectable()
export class PostsService {
  private readonly identityBaseUrl: string;
  private readonly graphBaseUrl: string;

  constructor(private readonly pool: Pool) {
    this.identityBaseUrl =
      process.env.IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001';
    this.graphBaseUrl = process.env.GRAPH_BASE_URL ?? 'http://127.0.0.1:3003';
  }

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

    // Enrichment outside the write TX (failure-tolerant for mentions).
    const mentionUsernames = extractMentions(content);
    const hashtags = extractHashtags(content);
    const resolvedMentions = await this.resolveMentions(mentionUsernames);
    const authorVisibility = await this.fetchUserVisibility(authorId);

    // Abuse: identical non-empty body from same author within the window → 409.
    if (content.length > 0 && !replyToId) {
      await this.assertNotDuplicateContent(authorId, content);
    }

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

      await this.persistHashtags(client, id, hashtags);
      await this.persistMentions(client, id, resolvedMentions);

      const post = mapPost(row.rows[0] as PostRow);
      post.mentions = resolvedMentions.map((m) => ({
        username: m.username,
        userId: m.userId,
      }));

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
            authorVisibility: authorVisibility ?? 'public',
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

      // One mention event per resolved distinct user (skip self).
      const notified = new Set<string>();
      for (const m of resolvedMentions) {
        if (!m.userId || m.userId === authorId || notified.has(m.userId)) {
          continue;
        }
        notified.add(m.userId);
        await appendOutbox(client, 'post', {
          aggregateType: 'post',
          aggregateId: post.id,
          eventType: 'user.mentioned',
          partitionKey: m.userId,
          topic: POST_TOPIC,
          payload: {
            postId: post.id,
            authorId: post.authorId,
            mentionedUserId: m.userId,
            username: m.username,
          },
        });
      }

      return post;
    });
  }

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

  private async persistHashtags(
    client: PoolClient,
    postId: string,
    tags: { tag: string; display: string }[],
  ): Promise<void> {
    for (const t of tags) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM post.hashtags WHERE tag = $1`,
        [t.tag],
      );
      let hashtagId = existing.rows[0]?.id;
      if (!hashtagId) {
        hashtagId = uuidv7();
        await client.query(
          `INSERT INTO post.hashtags (id, tag, tag_display)
           VALUES ($1, $2, $3)
           ON CONFLICT (tag) DO NOTHING`,
          [hashtagId, t.tag, t.display],
        );
        const again = await client.query<{ id: string }>(
          `SELECT id FROM post.hashtags WHERE tag = $1`,
          [t.tag],
        );
        hashtagId = again.rows[0]?.id ?? hashtagId;
      }
      await client.query(
        `INSERT INTO post.post_hashtags (post_id, hashtag_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [postId, hashtagId],
      );
    }
  }

  private async persistMentions(
    client: PoolClient,
    postId: string,
    mentions: { username: string; userId: string | null }[],
  ): Promise<void> {
    for (const m of mentions) {
      await client.query(
        `INSERT INTO post.mentions (post_id, raw_username, mentioned_user_id, resolved_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [postId, m.username, m.userId, m.userId ? new Date() : null],
      );
    }
  }

  /**
   * Resolve usernames via identity (deadline ~300ms each, failure → unresolved).
   */
  /**
   * Reject near-identical repost spam: same author + exact content within N hours
   * (default 24). Pure reposts (empty body) are excluded.
   */
  private async assertNotDuplicateContent(
    authorId: string,
    content: string,
  ): Promise<void> {
    if (process.env.POST_DUPLICATE_DETECT === '0') return;
    const hours = Number(process.env.POST_DUPLICATE_WINDOW_HOURS ?? 24);
    const windowHours =
      Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : 24;
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM post.posts
       WHERE author_id = $1
         AND content = $2
         AND deleted_at IS NULL
         AND reply_to_id IS NULL
         AND created_at > now() - ($3::text || ' hours')::interval
       LIMIT 1`,
      [authorId, content, String(windowHours)],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ConflictException({
        type: 'https://api.social.example.com/problems/duplicate-content',
        title: 'Duplicate content',
        status: 409,
        detail: `Identical post body within the last ${windowHours} hours`,
      });
    }
  }

  private async resolveMentions(
    usernames: string[],
  ): Promise<{ username: string; userId: string | null }[]> {
    const out: { username: string; userId: string | null }[] = [];
    for (const username of usernames) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 300);
        const res = await fetch(
          `${this.identityBaseUrl}/v1/users/by-username/${encodeURIComponent(username)}`,
          { signal: ac.signal },
        );
        clearTimeout(timer);
        if (!res.ok) {
          out.push({ username, userId: null });
          continue;
        }
        const json = (await res.json()) as { user?: { id?: string } };
        out.push({
          username,
          userId: typeof json.user?.id === 'string' ? json.user.id : null,
        });
      } catch {
        out.push({ username, userId: null });
      }
    }
    return out;
  }

  private async fetchUserVisibility(userId: string): Promise<string | null> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 300);
      const res = await fetch(
        `${this.identityBaseUrl}/v1/users/${encodeURIComponent(userId)}`,
        { signal: ac.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = (await res.json()) as { user?: { visibility?: string } };
      return json.user?.visibility ?? null;
    } catch {
      return null;
    }
  }

  private async isFollowing(
    followerId: string,
    followeeId: string,
  ): Promise<boolean> {
    try {
      const q = new URLSearchParams({ followerId, followeeId });
      const res = await fetch(
        `${this.graphBaseUrl}/v1/graph/relationship/following?${q}`,
      );
      if (!res.ok) return false;
      const json = (await res.json()) as { following?: boolean };
      return json.following === true;
    } catch {
      return false;
    }
  }

  /**
   * Private (followers) authors: only self or accepted followers may read.
   * 404 not 403 (existence is private). Fail closed when relationship unknown.
   */
  async assertCanViewAuthor(
    authorId: string,
    viewerId?: string,
  ): Promise<void> {
    if (viewerId && viewerId === authorId) return;
    const visibility = await this.fetchUserVisibility(authorId);
    // Identity down: fail open so public content still works (availability).
    if (!visibility || visibility === 'public') return;
    if (visibility === 'followers') {
      if (!viewerId) {
        throw new NotFoundException('Post not found');
      }
      const ok = await this.isFollowing(viewerId, authorId);
      if (!ok) {
        throw new NotFoundException('Post not found');
      }
    }
  }

  async getById(postId: string, viewerId?: string): Promise<PostDto> {
    const row = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE id = $1 AND deleted_at IS NULL`,
      [postId],
    );
    const p = row.rows[0] as PostRow | undefined;
    if (!p) throw new NotFoundException('Post not found');
    await this.assertCanViewAuthor(p.author_id, viewerId);
    const post = mapPost(p);
    post.mentions = await this.loadMentions(postId);
    await this.attachViewerStates([post], viewerId);
    return post;
  }

  /**
   * Hydrate by ids. Optional viewerId attaches liked/reposted flags.
   * No visibility check — timeline/gateway already authorized the viewer.
   */
  async getByIds(ids: string[], viewerId?: string): Promise<PostDto[]> {
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
    const posts = ids
      .map((id) => byId.get(id))
      .filter((p): p is PostDto => !!p);
    await this.attachViewerStates(posts, viewerId);
    return posts;
  }

  /** Batch viewer state for a set of post ids (≤100). */
  async getViewerStates(
    viewerId: string,
    postIds: string[],
  ): Promise<Record<string, ViewerState>> {
    const ids = [...new Set(postIds)].slice(0, 100);
    const out: Record<string, ViewerState> = {};
    for (const id of ids) {
      out[id] = { liked: false, reposted: false };
    }
    if (ids.length === 0) return out;

    const liked = await this.pool.query<{ post_id: string }>(
      `SELECT post_id FROM post.likes
       WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
      [viewerId, ids],
    );
    for (const r of liked.rows) {
      const s = out[r.post_id];
      if (s) s.liked = true;
    }

    const reposted = await this.pool.query<{ repost_of_id: string }>(
      `SELECT DISTINCT repost_of_id FROM post.posts
       WHERE author_id = $1
         AND deleted_at IS NULL
         AND repost_of_id = ANY($2::uuid[])`,
      [viewerId, ids],
    );
    for (const r of reposted.rows) {
      const s = out[r.repost_of_id];
      if (s) s.reposted = true;
    }
    return out;
  }

  private async attachViewerStates(
    posts: PostDto[],
    viewerId?: string,
  ): Promise<void> {
    if (!viewerId || posts.length === 0) return;
    const states = await this.getViewerStates(
      viewerId,
      posts.map((p) => p.id),
    );
    for (const p of posts) {
      const s = states[p.id];
      p.viewerLiked = s?.liked ?? false;
      p.viewerReposted = s?.reposted ?? false;
    }
  }

  async listByAuthor(
    authorId: string,
    limit = 20,
    viewerId?: string,
    cursor?: string,
  ): Promise<{ posts: PostDto[]; page: PageMeta }> {
    await this.assertCanViewAuthor(authorId, viewerId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    let beforeId: string | null = null;
    if (cursor) {
      try {
        const c = decodeCursor<{ id?: string }>(cursor);
        beforeId = typeof c.id === 'string' ? c.id : null;
        if (!beforeId) throw new Error('invalid_cursor');
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE author_id = $1 AND deleted_at IS NULL AND reply_to_id IS NULL
         AND ($2::uuid IS NULL OR id < $2::uuid)
       ORDER BY id DESC
       LIMIT $3`,
      [authorId, beforeId, safeLimit + 1],
    );
    const mapped = (rows.rows as PostRow[]).map(mapPost);
    const { items, page } = paginateRows(mapped, safeLimit, (p) => ({
      id: p.id,
    }));
    await this.attachViewerStates(items, viewerId);
    return { posts: items, page };
  }

  async listReplies(
    parentId: string,
    limit = 50,
    viewerId?: string,
  ): Promise<PostDto[]> {
    const parent = await this.pool.query<{ author_id: string }>(
      `SELECT author_id FROM post.posts WHERE id = $1 AND deleted_at IS NULL`,
      [parentId],
    );
    const p = parent.rows[0];
    if (!p) throw new NotFoundException('Post not found');
    await this.assertCanViewAuthor(p.author_id, viewerId);

    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.pool.query(
      `SELECT ${POST_SELECT}
       FROM post.posts
       WHERE reply_to_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT $2`,
      [parentId, safeLimit],
    );
    const posts = (rows.rows as PostRow[]).map(mapPost);
    await this.attachViewerStates(posts, viewerId);
    return posts;
  }

  async getThread(
    rootOrPostId: string,
    limit = 50,
    viewerId?: string,
  ): Promise<{ root: PostDto | null; posts: PostDto[] }> {
    const anchor = await this.pool.query<{
      id: string;
      author_id: string;
      thread_root_id: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT id, author_id, thread_root_id, deleted_at FROM post.posts WHERE id = $1`,
      [rootOrPostId],
    );
    const a = anchor.rows[0];
    if (!a) throw new NotFoundException('Post not found');
    await this.assertCanViewAuthor(a.author_id, viewerId);

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
    const posts = (rows.rows as PostRow[]).map(mapPost);
    const withStates = root ? [root, ...posts] : posts;
    await this.attachViewerStates(withStates, viewerId);
    return { root, posts };
  }

  private async loadMentions(postId: string): Promise<MentionDto[]> {
    const rows = await this.pool.query<{
      raw_username: string;
      mentioned_user_id: string | null;
    }>(
      `SELECT raw_username, mentioned_user_id FROM post.mentions
       WHERE post_id = $1 ORDER BY raw_username`,
      [postId],
    );
    return rows.rows.map((r) => ({
      username: r.raw_username,
      userId: r.mentioned_user_id,
    }));
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
    const peek = await this.pool.query<{ author_id: string }>(
      `SELECT author_id FROM post.posts WHERE id = $1 AND deleted_at IS NULL`,
      [postId],
    );
    if ((peek.rowCount ?? 0) === 0) {
      throw new NotFoundException('Post not found');
    }
    await this.assertCanViewAuthor(peek.rows[0]!.author_id, userId);

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
