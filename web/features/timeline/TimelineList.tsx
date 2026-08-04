'use client';

/**
 * Home timeline read path.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 */
import {
  useHomeTimeline,
  useNewPostsCount,
  useRefreshHomeTimeline,
} from '@/data/queries/timeline';
import { Button } from '@/ui';
import { DegradedBanner } from './DegradedBanner';
import { NewPostsPill } from './NewPostsPill';
import { clearScrollOffset } from './scroll-position';
import { TimelineSkeleton } from './TimelineSkeleton';
import { VirtualTimeline } from './VirtualTimeline';

export function TimelineList() {
  const query = useHomeTimeline();
  const posts = (query.data?.pages ?? []).flatMap((p) => p.data);
  const { count: newPosts } = useNewPostsCount(posts[0]?.id);
  const refresh = useRefreshHomeTimeline();

  function showNewPosts() {
    // Top first: the list is replaced under the reader either way, and landing
    // mid-feed in unfamiliar posts is worse than landing at a known top.
    clearScrollOffset();
    window.scrollTo({ top: 0 });
    void refresh();
  }

  function reachedPrefetchPoint() {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }

  if (query.isPending) {
    return (
      <>
        <DegradedBanner />
        <TimelineSkeleton />
      </>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-3 px-4 py-6" data-testid="timeline-error">
        <p className="text-sm text-fg">
          We couldn&apos;t load your timeline just now.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            void query.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <DegradedBanner />
      <NewPostsPill count={newPosts} onShow={showNewPosts} />

      {posts.length === 0 ? (
        <div className="px-4 py-10 text-center" data-testid="timeline-empty">
          <p className="text-sm text-fg">Your timeline is empty.</p>
          <p className="mt-1 text-sm text-fg-muted">
            Follow a few people and their posts will show up here.
          </p>
        </div>
      ) : (
        <VirtualTimeline
          posts={posts}
          onReachPrefetchPoint={reachedPrefetchPoint}
          prefetchDisabled={!query.hasNextPage}
          busy={query.isFetchingNextPage}
        />
      )}

      {query.hasNextPage ? (
        <div className="px-4 py-4">
          <Button
            type="button"
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
