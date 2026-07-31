import { Injectable, Logger } from '@nestjs/common';
import { EsClient } from './es.client';

export const POSTS_INDEX = 'posts_v1';
export const USERS_INDEX = 'users_v1';

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

export interface PostDoc {
  id: string;
  authorId: string;
  content: string;
  hashtags: string[];
  likeCount: number;
  replyCount: number;
  authorVisibility: string;
  authorStatus: string;
  createdAt: string;
}

export interface UserDoc {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  followerCount: number;
  isVerified: boolean;
  visibility: string;
  status: string;
  discoverable: boolean;
  createdAt: string;
}

export interface SearchResult {
  posts: Array<{
    id: string;
    authorId: string;
    content: string;
    score: number;
  }>;
  users: Array<{
    id: string;
    username: string;
    displayName: string;
    score: number;
  }>;
  degraded: boolean;
}

@Injectable()
export class SearchService {
  private readonly log = new Logger(SearchService.name);
  private ready = false;

  constructor(private readonly es: EsClient) {}

  async ensureIndices(): Promise<void> {
    await this.es.ensureIndex(POSTS_INDEX, {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        refresh_interval: '5s',
        analysis: {
          analyzer: {
            content: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
        },
      },
      mappings: {
        dynamic: 'strict',
        properties: {
          id: { type: 'keyword' },
          author_id: { type: 'keyword' },
          content: { type: 'text', analyzer: 'content' },
          hashtags: { type: 'keyword' },
          like_count: { type: 'integer' },
          reply_count: { type: 'integer' },
          author_visibility: { type: 'keyword' },
          author_status: { type: 'keyword' },
          created_at: { type: 'date' },
        },
      },
    });

    await this.es.ensureIndex(USERS_INDEX, {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        refresh_interval: '5s',
        analysis: {
          filter: {
            edge_ngram_2_20: {
              type: 'edge_ngram',
              min_gram: 2,
              max_gram: 20,
            },
          },
          analyzer: {
            content: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
            username_prefix: {
              type: 'custom',
              tokenizer: 'keyword',
              filter: ['lowercase', 'edge_ngram_2_20'],
            },
          },
        },
      },
      mappings: {
        dynamic: 'strict',
        properties: {
          id: { type: 'keyword' },
          username: {
            type: 'text',
            analyzer: 'username_prefix',
            fields: { exact: { type: 'keyword' } },
          },
          display_name: { type: 'text', analyzer: 'content' },
          bio: { type: 'text', analyzer: 'content' },
          follower_count: { type: 'integer' },
          is_verified: { type: 'boolean' },
          visibility: { type: 'keyword' },
          status: { type: 'keyword' },
          discoverable: { type: 'boolean' },
          created_at: { type: 'date' },
        },
      },
    });
    this.ready = true;
  }

  async indexPost(input: {
    postId: string;
    authorId: string;
    content: string;
    createdAt?: string;
    likeCount?: number;
    replyCount?: number;
  }): Promise<void> {
    const hashtags = extractHashtags(input.content);
    await this.es.indexDoc(POSTS_INDEX, input.postId, {
      id: input.postId,
      author_id: input.authorId,
      content: input.content,
      hashtags,
      like_count: input.likeCount ?? 0,
      reply_count: input.replyCount ?? 0,
      author_visibility: 'public',
      author_status: 'active',
      created_at: input.createdAt ?? new Date().toISOString(),
    });
  }

  async deletePost(postId: string): Promise<void> {
    await this.es.deleteDoc(POSTS_INDEX, postId);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.es.deleteDoc(USERS_INDEX, userId);
  }

  async deletePostsByAuthor(authorId: string): Promise<void> {
    await this.es.deleteByQuery(POSTS_INDEX, {
      term: { author_id: authorId },
    });
  }

  async indexUser(input: {
    userId: string;
    username: string;
    displayName?: string;
    bio?: string;
    followerCount?: number;
    isVerified?: boolean;
    visibility?: string;
    status?: string;
    discoverable?: boolean;
    createdAt?: string;
  }): Promise<void> {
    await this.es.indexDoc(USERS_INDEX, input.userId, {
      id: input.userId,
      username: input.username,
      display_name: input.displayName ?? input.username,
      bio: input.bio ?? '',
      follower_count: input.followerCount ?? 0,
      is_verified: input.isVerified ?? false,
      visibility: input.visibility ?? 'public',
      status: input.status ?? 'active',
      discoverable: input.discoverable ?? true,
      created_at: input.createdAt ?? new Date().toISOString(),
    });
  }

  async processDomainEvent(input: {
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<'handled' | 'skipped'> {
    if (input.eventType === 'post.created') {
      const postId = asString(input.payload.postId);
      const authorId = asString(input.payload.authorId);
      const content = asString(input.payload.content);
      if (!postId || !authorId) return 'skipped';
      const createdAt = asString(input.payload.createdAt);
      await this.indexPost({
        postId,
        authorId,
        content,
        ...(createdAt ? { createdAt } : {}),
      });
      return 'handled';
    }
    if (input.eventType === 'post.deleted') {
      const postId = asString(input.payload.postId);
      if (!postId) return 'skipped';
      await this.deletePost(postId);
      return 'handled';
    }
    if (
      input.eventType === 'user.created' ||
      input.eventType === 'user.updated'
    ) {
      const userId = asString(input.payload.userId);
      const username = asString(input.payload.username);
      if (!userId || !username) return 'skipped';
      const displayName = asString(input.payload.displayName);
      const bio = asString(input.payload.bio);
      const visibility = asString(input.payload.visibility);
      const status = asString(input.payload.status);
      const createdAt = asString(input.payload.createdAt);
      const followerCount = asNumber(input.payload.followerCount);
      const isVerified = input.payload.isVerified === true;
      // Private accounts remain in the users index for username discovery,
      // but their posts are not independently searchable as public.
      await this.indexUser({
        userId,
        username,
        ...(displayName ? { displayName } : {}),
        ...(bio ? { bio } : {}),
        ...(visibility ? { visibility } : {}),
        ...(status ? { status } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(followerCount !== undefined ? { followerCount } : {}),
        isVerified,
        discoverable: status !== 'deactivated' && status !== 'erased',
      });
      // Visibility flip to private: drop public post docs for this author
      if (visibility === 'private' || visibility === 'followers') {
        await this.deletePostsByAuthor(userId);
      }
      return 'handled';
    }
    if (
      input.eventType === 'user.deactivated' ||
      input.eventType === 'user.erased'
    ) {
      const userId = asString(input.payload.userId);
      if (!userId) return 'skipped';
      await this.deleteUser(userId);
      await this.deletePostsByAuthor(userId);
      return 'handled';
    }
    // likes ignored — design: like_count refreshed on reconcile only
    return 'skipped';
  }

  async search(q: string, type?: string, limit = 20): Promise<SearchResult> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const query = q.trim();
    if (!query) {
      return { posts: [], users: [], degraded: false };
    }

    const wantPosts = !type || type === 'post' || type === 'all';
    const wantUsers = !type || type === 'user' || type === 'all';
    let degraded = false;
    const posts: SearchResult['posts'] = [];
    const users: SearchResult['users'] = [];

    if (wantPosts) {
      try {
        const res = await this.es.search(POSTS_INDEX, {
          size: safeLimit,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query,
                    fields: ['content', 'hashtags'],
                  },
                },
              ],
              filter: [
                { term: { author_status: 'active' } },
                { term: { author_visibility: 'public' } },
              ],
            },
          },
        });
        for (const hit of res.hits.hits) {
          const s = hit._source;
          posts.push({
            id: String(s.id ?? hit._id),
            authorId: String(s.author_id ?? ''),
            content: String(s.content ?? ''),
            score: hit._score ?? 0,
          });
        }
      } catch (err) {
        this.log.warn(`post search degraded: ${String(err)}`);
        degraded = true;
      }
    }

    if (wantUsers) {
      try {
        const res = await this.es.search(USERS_INDEX, {
          size: safeLimit,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query,
                    fields: [
                      'username^3',
                      'username.exact^5',
                      'display_name',
                      'bio',
                    ],
                  },
                },
              ],
              filter: [
                { term: { status: 'active' } },
                { term: { discoverable: true } },
              ],
            },
          },
        });
        for (const hit of res.hits.hits) {
          const s = hit._source;
          users.push({
            id: String(s.id ?? hit._id),
            username: String(s.username ?? ''),
            displayName: String(s.display_name ?? ''),
            score: hit._score ?? 0,
          });
        }
      } catch (err) {
        this.log.warn(`user search degraded: ${String(err)}`);
        degraded = true;
      }
    }

    return { posts, users, degraded };
  }

  isReady(): boolean {
    return this.ready;
  }
}

function extractHashtags(content: string): string[] {
  const tags = new Set<string>();
  for (const m of content.matchAll(HASHTAG_RE)) {
    if (m[1]) tags.add(m[1].toLowerCase());
  }
  return [...tags];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}
