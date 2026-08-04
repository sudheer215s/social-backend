'use client';

/**
 * Home timeline read path.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 */
import { useHomeTimeline } from '@/data/queries/timeline';
import { PostCard } from '@/features/post';
import { Button } from '@/ui';
import { DegradedBanner } from './DegradedBanner';
import { TimelineSkeleton } from './TimelineSkeleton';

export function TimelineList() {
  const query = useHomeTimeline();
  const posts = (query.data?.pages ?? []).flatMap((p) => p.data);

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

      {posts.length === 0 ? (
        <div className="px-4 py-10 text-center" data-testid="timeline-empty">
          <p className="text-sm text-fg">Your timeline is empty.</p>
          <p className="mt-1 text-sm text-fg-muted">
            Follow a few people and their posts will show up here.
          </p>
        </div>
      ) : (
        <div
          role="feed"
          aria-busy={query.isFetchingNextPage}
          aria-label="Home timeline"
        >
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
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
