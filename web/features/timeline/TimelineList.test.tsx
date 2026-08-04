import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as timeline from '@/data/queries/timeline';
import type { Post, TimelinePage } from '@/data/queries/timeline';
import { prefetchIndexFor, TimelineList } from './TimelineList';

type Query = ReturnType<typeof timeline.useHomeTimeline>;

function post(i: number): Post {
  return {
    id: `post_${i}`,
    author: { id: 'user_1', username: 'alice', display_name: 'Alice' },
    content: `Post ${i}`,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
    like_count: 0,
    reply_count: 0,
    repost_count: 0,
  };
}

function page(from: number, count: number, hasMore = true): TimelinePage {
  return {
    data: Array.from({ length: count }, (_, i) => post(from + i)),
    page: { next_cursor: hasMore ? 'opaque' : null, has_more: hasMore },
  };
}

function mockQuery(overrides: Partial<Query>): Query {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as Query;
}

describe('TimelineList (F2-T03)', () => {
  beforeEach(() => {
    // The polling hooks need a QueryClient; every test here drives the list
    // through its own stubbed state instead.
    vi.spyOn(timeline, 'useNewPostsCount').mockReturnValue({
      count: 0,
      isFetched: true,
    });
    vi.spyOn(timeline, 'useRefreshHomeTimeline').mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows skeletons on first load, not a spinner', () => {
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({ isPending: true, isSuccess: false }),
    );

    render(<TimelineList />);

    expect(
      screen.getAllByTestId('timeline-skeleton-item').length,
    ).toBeGreaterThan(0);
  });

  it('renders every loaded page in order under role="feed"', () => {
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 3), page(3, 2)], pageParams: [] },
      } as Partial<Query>),
    );

    render(<TimelineList />);

    const feed = screen.getByRole('feed');
    expect(feed).toBeInTheDocument();
    const rendered = Array.from(feed.querySelectorAll('[data-post-id]')).map(
      (el) => el.getAttribute('data-post-id'),
    );
    expect(rendered).toEqual([
      'post_0',
      'post_1',
      'post_2',
      'post_3',
      'post_4',
    ]);
  });

  it('tells the user the feed is empty instead of rendering nothing', () => {
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 0, false)], pageParams: [] },
      } as Partial<Query>),
    );

    render(<TimelineList />);

    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });

  it('offers a retry when the first load fails', async () => {
    const refetch = vi.fn();
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({ isError: true, isSuccess: false, refetch }),
    );

    render(<TimelineList />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /try again/i }));

    expect(refetch).toHaveBeenCalled();
  });

  it('loads the next page on demand and hides the control at the end', async () => {
    const fetchNextPage = vi.fn();
    const spy = vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 2)], pageParams: [] },
        hasNextPage: true,
        fetchNextPage,
      } as Partial<Query>),
    );

    const view = render(<TimelineList />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalled();

    spy.mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 2, false)], pageParams: [] },
        hasNextPage: false,
      } as Partial<Query>),
    );
    view.rerender(<TimelineList />);

    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('marks the feed busy while a further page is loading', () => {
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 2)], pageParams: [] },
        hasNextPage: true,
        isFetchingNextPage: true,
      } as Partial<Query>),
    );

    render(<TimelineList />);

    expect(screen.getByRole('feed')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('TimelineList prefetch and new posts (F2-T04)', () => {
  let fire: (() => void)[] = [];

  beforeEach(() => {
    fire = [];
    class StubIntersectionObserver {
      constructor(private cb: IntersectionObserverCallback) {
        fire.push(() =>
          this.cb(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
    vi.spyOn(timeline, 'useNewPostsCount').mockReturnValue({
      count: 0,
      isFetched: true,
    });
    vi.spyOn(timeline, 'useRefreshHomeTimeline').mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('places the sentinel 70% down the list, not at the end', () => {
    expect(prefetchIndexFor(10)).toBe(7);
    expect(prefetchIndexFor(20)).toBe(14);
    expect(prefetchIndexFor(0)).toBe(-1);

    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 10)], pageParams: [] },
        hasNextPage: true,
      } as Partial<Query>),
    );

    render(<TimelineList />);

    const nodes = Array.from(
      screen
        .getByRole('feed')
        .querySelectorAll('[data-post-id], [data-testid="prefetch-sentinel"]'),
    );
    expect(nodes[7]).toHaveAttribute('data-testid', 'prefetch-sentinel');
    expect(nodes[8]).toHaveAttribute('data-post-id', 'post_7');
  });

  it('fetches the next page when the sentinel comes into view', () => {
    const fetchNextPage = vi.fn();
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 10)], pageParams: [] },
        hasNextPage: true,
        fetchNextPage,
      } as Partial<Query>),
    );

    render(<TimelineList />);
    fire[0]?.();

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not stack requests while a page is already loading', () => {
    const fetchNextPage = vi.fn();
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 10)], pageParams: [] },
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage,
      } as Partial<Query>),
    );

    render(<TimelineList />);
    fire[0]?.();

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('announces new posts without adding them to the list', () => {
    vi.spyOn(timeline, 'useNewPostsCount').mockReturnValue({
      count: 3,
      isFetched: true,
    });
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 3)], pageParams: [] },
      } as Partial<Query>),
    );

    render(<TimelineList />);

    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(
      '3 new posts',
    );
    expect(
      screen.getByRole('feed').querySelectorAll('[data-post-id]'),
    ).toHaveLength(3);
  });

  it('reloads from the top only when the reader taps the pill', async () => {
    const refresh = vi.fn();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.spyOn(timeline, 'useRefreshHomeTimeline').mockReturnValue(refresh);
    vi.spyOn(timeline, 'useNewPostsCount').mockReturnValue({
      count: 3,
      isFetched: true,
    });
    vi.spyOn(timeline, 'useHomeTimeline').mockReturnValue(
      mockQuery({
        data: { pages: [page(0, 3)], pageParams: [] },
      } as Partial<Query>),
    );

    render(<TimelineList />);
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByTestId('new-posts-pill'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
