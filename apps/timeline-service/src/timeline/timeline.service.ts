import { Injectable } from '@nestjs/common';
import type { TimelineStore } from './timeline.store';

@Injectable()
export class TimelineService {
  constructor(
    private readonly store: TimelineStore,
    private readonly graphBaseUrl: string,
    private readonly postBaseUrl: string,
  ) {}

  async fanoutPost(authorId: string, postId: string): Promise<number> {
    // Always try author self-timeline if materialised
    let written = 0;
    if (await this.store.fanoutIfExists(authorId, postId)) {
      written += 1;
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
    const postIds = await this.store.page(userId, limit, before);
    // If still empty after rebuild, return empty
    if (postIds.length === 0 && !rebuilt) {
      await this.rebuild(userId);
      rebuilt = true;
      return { postIds: await this.store.page(userId, limit, before), rebuilt };
    }
    return { postIds, rebuilt };
  }

  async hydratePosts(postIds: string[]): Promise<unknown[]> {
    if (postIds.length === 0) return [];
    const res = await fetch(
      `${this.postBaseUrl}/v1/posts/batch?ids=${encodeURIComponent(postIds.join(','))}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { posts?: unknown[] };
    return json.posts ?? [];
  }

  async rebuild(userId: string): Promise<void> {
    const following = await this.fetchFollowingIds(userId);
    const authorIds = [userId, ...following].slice(0, 100);
    const postIds: string[] = [];
    for (const authorId of authorIds) {
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
    // Sort UUIDv7 descending (newest first)
    postIds.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    await this.store.replaceTimeline(userId, postIds.slice(0, 400));
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
