'use client';

/**
 * Home timeline — cursor pagination over the standard envelope.
 * @see docs/frontend/04-modules/data-layer.md §3
 * @see docs/03-cross-cutting/api-conventions.md §3
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { request } from '@/api-client';
import { queryKeys } from '../keys';

export type PostAuthor = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
};

export type Post = {
  id: string;
  author: PostAuthor;
  content: string;
  created_at: string;
  like_count: number;
  reply_count: number;
  repost_count: number;
  /** Read-your-writes; the counts beside it are approximate. */
  liked?: boolean;
  reposted?: boolean;
  /**
   * Hydration tombstone — deleted post, blocked author, or suspended account.
   * The reason, if the server sends one, is deliberately not modelled: the UI
   * renders all three identically.
   */
  unavailable?: boolean;
};

export type PageInfo = {
  /** Opaque. Never parsed, compared, sliced, or constructed. */
  next_cursor: string | null;
  has_more: boolean;
};

export type TimelinePage = {
  data: Post[];
  page: PageInfo;
};

export const TIMELINE_PAGE_SIZE = 20;

/**
 * Bounds memory on a long scroll session. Dropped pages are re-fetched if the
 * user scrolls back, which is rare and cheaper than holding 2,000 posts.
 */
export const MAX_TIMELINE_PAGES = 10;

/** 30 s: the freshness SLO is 5 s, but refetching that often is pointless churn. */
export const TIMELINE_STALE_MS = 30_000;

export async function fetchHomeTimeline(
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<TimelinePage> {
  const params = new URLSearchParams({ limit: String(TIMELINE_PAGE_SIZE) });
  if (cursor !== undefined) params.set('cursor', cursor);

  const { data } = await request<TimelinePage>(
    `/v1/timelines/home?${params.toString()}`,
    {
      // Deep pages past the materialised window are slower, not different.
      deadline: 'timeline',
      rateLimitScope: 'timeline',
      ...(signal ? { signal } : {}),
    },
  );
  return data;
}

export function useHomeTimeline(enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.timelineHome(),
    queryFn: ({ pageParam, signal }) => fetchHomeTimeline(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TimelinePage) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
    staleTime: TIMELINE_STALE_MS,
    maxPages: MAX_TIMELINE_PAGES,
    refetchOnWindowFocus: true,
    enabled,
  });
}
