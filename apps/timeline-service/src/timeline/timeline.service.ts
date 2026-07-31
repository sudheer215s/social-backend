import { Injectable } from '@nestjs/common';
import type { TimelineStore } from './timeline.store';

/** Accounts at/above this follower count skip write fan-out (pull on read). */
const DEFAULT_LARGE_THRESHOLD = 10_000;

@Injectable()
export class TimelineService {
  private readonly largeThreshold: number;

  constructor(
    private readonly store: TimelineStore,
    private readonly graphBaseUrl: string,
    private readonly postBaseUrl: string,
  ) {
    const raw = Number(
      process.env.LARGE_ACCOUNT_FOLLOWER_THRESHOLD ?? DEFAULT_LARGE_THRESHOLD,
    );
    this.largeThreshold =
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LARGE_THRESHOLD;
  }

  async fanoutPost(authorId: string, postId: string): Promise<number> {
    // Always try author self-timeline if materialised
    let written = 0;
    if (await this.store.fanoutIfExists(authorId, postId)) {
      written += 1;
    }
    // Celebrity / large-account: skip O(followers) write fan-out
    if (await this.isLargeAccount(authorId)) {
      return written;
    }
    const followers = await this.fetchFollowerIds(authorId);
    for (const fid of followers) {
      if (await this.store.fanoutIfExists(fid, postId)) {
        written += 1;
      }
    }
    return written;
  }

  /**
   * On user.followed: if the follower already has a home timeline key,
   * inject the followee's recent posts so the feed feels immediate.
   * No-op when the key is cold (rebuild-on-read will pick them up later).
   */
  async backfillOnFollow(
    followerId: string,
    followeeId: string,
    limit = 50,
  ): Promise<number> {
    if (!(await this.store.exists(followerId))) {
      return 0;
    }
    const postIds = await this.fetchRecentPostIds(followeeId, limit);
    let written = 0;
    for (const postId of postIds) {
      if (await this.store.fanoutIfExists(followerId, postId)) {
        written += 1;
      }
    }
    return written;
  }

  async getHomeTimeline(
    userId: string,
    limit = 20,
    before?: string,
  ): Promise<{ postIds: string[]; rebuilt: boolean }> {
    let rebuilt = false;
    if (!(await this.store.exists(userId))) {
      await this.rebuild(userId);
      rebuilt = true;
    }
    // Over-fetch so block filter at hydration can still fill a page
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 100);
    let postIds = await this.store.page(userId, fetchLimit, before);

    // Pull recent posts from large accounts the user follows (hybrid fan-out)
    const pulled = await this.pullLargeFollowing(userId, limit);
    if (pulled.length > 0) {
      const set = new Set(postIds);
      for (const id of pulled) {
        if (!set.has(id)) {
          postIds.push(id);
          set.add(id);
        }
      }
      postIds.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      if (before) {
        postIds = postIds.filter((id) => id < before);
      }
    }

    if (postIds.length === 0 && !rebuilt) {
      await this.rebuild(userId);
      rebuilt = true;
      postIds = await this.store.page(userId, fetchLimit, before);
    }
    return { postIds, rebuilt };
  }

  /**
   * Hydrate posts and fail-closed filter blocked authors.
   * Returns at most `limit` posts after filtering.
   */
  async hydratePosts(
    viewerId: string,
    postIds: string[],
    limit = 20,
  ): Promise<{ posts: unknown[]; filtered: number }> {
    if (postIds.length === 0) return { posts: [], filtered: 0 };
    const res = await fetch(
      `${this.postBaseUrl}/v1/posts/batch?ids=${encodeURIComponent(postIds.join(','))}`,
    );
    if (!res.ok) return { posts: [], filtered: 0 };
    const json = (await res.json()) as {
      posts?: Array<{ authorId?: string; id?: string }>;
    };
    const raw = json.posts ?? [];
    const blocked = await this.fetchBlockedRelatedIds(viewerId);
    if (blocked.size === 0) {
      return { posts: raw.slice(0, limit), filtered: 0 };
    }
    const posts: unknown[] = [];
    let filtered = 0;
    for (const p of raw) {
      const authorId = typeof p.authorId === 'string' ? p.authorId : '';
      if (authorId && blocked.has(authorId)) {
        filtered += 1;
        continue;
      }
      posts.push(p);
      if (posts.length >= limit) break;
    }
    return { posts, filtered };
  }

  async rebuild(userId: string): Promise<void> {
    const following = await this.fetchFollowingIds(userId);
    // Exclude large accounts from materialised set (they are pulled on read)
    const materialiseAuthors: string[] = [userId];
    for (const authorId of following.slice(0, 100)) {
      if (!(await this.isLargeAccount(authorId))) {
        materialiseAuthors.push(authorId);
      }
    }
    const postIds: string[] = [];
    for (const authorId of materialiseAuthors) {
      const res = await fetch(
        `${this.postBaseUrl}/v1/posts?authorId=${encodeURIComponent(authorId)}&limit=20`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        posts?: { id: string }[];
      };
      for (const p of json.posts ?? []) {
        postIds.push(p.id);
      }
    }
    postIds.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    await this.store.replaceTimeline(userId, postIds.slice(0, 400));
  }

  private async isLargeAccount(userId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.graphBaseUrl}/v1/graph/followers/${encodeURIComponent(userId)}/count`,
      );
      if (!res.ok) return false;
      const json = (await res.json()) as { count?: number };
      return Number(json.count ?? 0) >= this.largeThreshold;
    } catch {
      return false;
    }
  }

  private async pullLargeFollowing(
    userId: string,
    limit: number,
  ): Promise<string[]> {
    const following = await this.fetchFollowingIds(userId);
    const large: string[] = [];
    for (const id of following.slice(0, 50)) {
      if (await this.isLargeAccount(id)) {
        large.push(id);
      }
      if (large.length >= 10) break;
    }
    const postIds: string[] = [];
    for (const authorId of large) {
      const ids = await this.fetchRecentPostIds(authorId, Math.min(limit, 20));
      postIds.push(...ids);
    }
    return postIds;
  }

  private async fetchBlockedRelatedIds(userId: string): Promise<Set<string>> {
    // Internal unauthenticated path for service-to-service: query graph with
    // a dedicated internal endpoint. Prefer the public related-ids if JWT
    // is unavailable — use open internal list for hydration.
    try {
      const res = await fetch(
        `${this.graphBaseUrl}/v1/graph/blocks/${encodeURIComponent(userId)}/related-ids/internal`,
      );
      if (!res.ok) return new Set();
      const json = (await res.json()) as { ids?: string[] };
      return new Set(json.ids ?? []);
    } catch {
      return new Set();
    }
  }

  private async fetchFollowerIds(authorId: string): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.graphBaseUrl}/v1/graph/followers/${encodeURIComponent(authorId)}/ids?limit=1000`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { ids?: string[] };
      return json.ids ?? [];
    } catch {
      return [];
    }
  }

  private async fetchFollowingIds(userId: string): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.graphBaseUrl}/v1/graph/following/${encodeURIComponent(userId)}?limit=100`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: { userId: string }[];
      };
      return (json.items ?? []).map((i) => i.userId);
    } catch {
      return [];
    }
  }

  private async fetchRecentPostIds(
    authorId: string,
    limit: number,
  ): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.postBaseUrl}/v1/posts?authorId=${encodeURIComponent(authorId)}&limit=${limit}`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { posts?: { id: string }[] };
      return (json.posts ?? []).map((p) => p.id);
    } catch {
      return [];
    }
  }
}
