import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '@/data/queries/timeline';
import {
  clearHeights,
  estimateHeight,
  ESTIMATED_POST_HEIGHT,
  rememberHeight,
} from './height-cache';
import { PREFETCH_AT, VirtualTimeline } from './VirtualTimeline';

function posts(count: number): Post[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `post_${i}`,
    author: { id: 'user_1', username: 'alice', display_name: 'Alice' },
    content: `Post ${i}`,
    created_at: '2026-08-04T10:00:00.000Z',
    like_count: 0,
    reply_count: 0,
    repost_count: 0,
  }));
}

let fire: (() => void)[] = [];

function stubObserver() {
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
}

/**
 * jsdom performs no layout, so every measured card reports 0px and the
 * virtualiser collapses. Stand in for a browser that lays each card out at
 * exactly the height the cache predicted — `measureElement` reads offsetHeight.
 */
const realOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
);

function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const id = this.dataset?.measureId;
      return id ? estimateHeight(id) : 0;
    },
  });
}

function restoreLayout() {
  if (realOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      realOffsetHeight,
    );
  }
}

function feedHeight(): number {
  const feed = screen.getByRole('feed');
  return Number.parseFloat(feed.style.height);
}

describe('VirtualTimeline (F2-T05)', () => {
  beforeEach(() => {
    stubObserver();
    vi.stubGlobal('scrollTo', vi.fn());
    clearHeights();
    sessionStorage.clear();
    stubLayout();
  });

  afterEach(() => {
    restoreLayout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearHeights();
  });

  it('mounts a window of cards, not the whole feed', () => {
    render(
      <VirtualTimeline posts={posts(300)} onReachPrefetchPoint={vi.fn()} />,
    );

    const mounted = document.querySelectorAll('[data-post-id]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(50);
  });

  it('reserves the full height of the feed so the scrollbar stays honest', () => {
    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={vi.fn()} />,
    );

    expect(feedHeight()).toBe(10 * ESTIMATED_POST_HEIGHT);
  });

  it('uses measured heights over the estimate', () => {
    rememberHeight('post_0', 400);

    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={vi.fn()} />,
    );

    expect(feedHeight()).toBe(400 + 9 * ESTIMATED_POST_HEIGHT);
  });

  it('offsets each card by the heights of the cards above it', () => {
    rememberHeight('post_0', 400);

    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={vi.fn()} />,
    );

    const second = document.querySelector('[data-measure-id="post_1"]');
    expect(second).toHaveStyle({ transform: 'translateY(400px)' });
  });

  it('describes the logical set, not the mounted window, to assistive tech', () => {
    render(
      <VirtualTimeline posts={posts(300)} onReachPrefetchPoint={vi.fn()} />,
    );

    const first = document.querySelector('[data-post-id="post_0"]');
    expect(first).toHaveAttribute('aria-posinset', '1');
    expect(first).toHaveAttribute('aria-setsize', '300');
  });

  it('puts the prefetch trigger at 70% of the loaded height', () => {
    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={vi.fn()} />,
    );

    expect(screen.getByTestId('prefetch-anchor')).toHaveStyle({
      top: `${10 * ESTIMATED_POST_HEIGHT * PREFETCH_AT}px`,
    });
  });

  it('asks for the next page when that point is reached', () => {
    const onReach = vi.fn();

    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={onReach} />,
    );
    fire[0]?.();

    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('renders an empty feed without reserving space or observing', () => {
    render(<VirtualTimeline posts={[]} onReachPrefetchPoint={vi.fn()} />);

    expect(feedHeight()).toBe(0);
    expect(document.querySelectorAll('[data-post-id]')).toHaveLength(0);
  });

  it('marks the feed busy while another page loads', () => {
    render(
      <VirtualTimeline posts={posts(10)} onReachPrefetchPoint={vi.fn()} busy />,
    );

    expect(screen.getByRole('feed')).toHaveAttribute('aria-busy', 'true');
  });

  it('keys rows by post ID so a prepend does not remeasure every card', () => {
    rememberHeight('post_0', 400);
    rememberHeight('post_1', 220);

    const { rerender } = render(
      <VirtualTimeline posts={posts(5)} onReachPrefetchPoint={vi.fn()} />,
    );

    // Prepend a new head; existing IDs must still resolve their measured heights.
    const prepended: Post[] = [
      {
        id: 'post_new',
        author: { id: 'user_1', username: 'alice', display_name: 'Alice' },
        content: 'brand new',
        created_at: '2026-08-04T12:00:00.000Z',
        like_count: 0,
        reply_count: 0,
        repost_count: 0,
      },
      ...posts(5),
    ];
    rerender(
      <VirtualTimeline posts={prepended} onReachPrefetchPoint={vi.fn()} />,
    );

    expect(estimateHeight('post_0')).toBe(400);
    expect(estimateHeight('post_1')).toBe(220);
    // New head uses the estimate until measured.
    expect(estimateHeight('post_new')).toBe(ESTIMATED_POST_HEIGHT);
    // Total height = estimate for new + measured post_0 + post_1 + 3 estimates.
    expect(feedHeight()).toBe(
      ESTIMATED_POST_HEIGHT + 400 + 220 + 3 * ESTIMATED_POST_HEIGHT,
    );
  });
});
