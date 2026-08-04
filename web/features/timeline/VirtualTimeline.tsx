'use client';

/**
 * The virtualised feed. A 400-entry timeline of rich cards is thousands of DOM
 * nodes; without this, INP and memory both fail on mid-tier devices.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 * @see docs/frontend/03-flows.md §5 — scroll restoration
 */
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Post } from '@/data/queries/timeline';
import { PostCard } from '@/features/post';
import { estimateHeight, flushHeights, rememberHeight } from './height-cache';
import { PrefetchSentinel } from './PrefetchSentinel';
import { loadScrollOffset, saveScrollOffset } from './scroll-position';

/** Fetch the next page with ~30% of the loaded height still unread. */
export const PREFETCH_AT = 0.7;

/** Enough to avoid blank frames on a fast flick; more costs INP. */
export const OVERSCAN = 5;

export type VirtualTimelineProps = {
  posts: Post[];
  onReachPrefetchPoint: () => void;
  prefetchDisabled?: boolean;
  busy?: boolean;
};

export function VirtualTimeline({
  posts,
  onReachPrefetchPoint,
  prefetchDisabled,
  busy,
}: VirtualTimelineProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    // Keying by ID is what survives a prepended page: with index keys every
    // card remeasures and the scroll position jumps.
    getItemKey: (index) => posts[index]?.id ?? index,
    estimateSize: (index) => {
      const id = posts[index]?.id;
      return id ? estimateHeight(id) : 0;
    },
    overscan: OVERSCAN,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      virtualizer.measureElement(el);
      const id = el.dataset.measureId;
      if (id) rememberHeight(id, el.offsetHeight);
    },
    [virtualizer],
  );

  // Heights load synchronously from sessionStorage inside estimateHeight.
  // Restore offset in layout so the first paint is already at the right place.
  useLayoutEffect(() => {
    if (restoredRef.current || posts.length === 0) return;
    const saved = loadScrollOffset();
    if (saved === null || saved === 0) {
      restoredRef.current = true;
      return;
    }
    restoredRef.current = true;
    window.scrollTo(0, saved);
    virtualizer.scrollToOffset(saved);
  }, [posts.length, virtualizer]);

  // Persist scroll while reading; flush heights so a hard back has measurements.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        saveScrollOffset(window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      saveScrollOffset(window.scrollY);
      flushHeights();
    };
  }, []);

  const total = virtualizer.getTotalSize();

  return (
    <div
      ref={listRef}
      role="feed"
      aria-busy={busy}
      aria-label="Home timeline"
      className="relative"
      style={{ height: total }}
      data-testid="virtual-timeline"
    >
      {posts.length > 0 ? (
        <div
          data-testid="prefetch-anchor"
          className="pointer-events-none absolute left-0 h-px w-full"
          style={{ top: total * PREFETCH_AT }}
        >
          <PrefetchSentinel
            onReach={onReachPrefetchPoint}
            disabled={prefetchDisabled === true}
          />
        </div>
      ) : null}

      {virtualizer.getVirtualItems().map((item) => {
        const post = posts[item.index];
        if (!post) return null;
        return (
          <div
            key={item.key}
            ref={measure}
            data-index={item.index}
            data-measure-id={post.id}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {/* posinset/setsize describe the whole feed; the DOM holds a window. */}
            <PostCard
              post={post}
              posInSet={item.index + 1}
              setSize={posts.length}
            />
          </div>
        );
      })}
    </div>
  );
}
