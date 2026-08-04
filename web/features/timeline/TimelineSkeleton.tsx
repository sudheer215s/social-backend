'use client';

import { Skeleton } from '@/ui';

/**
 * Matches the real `PostCard` layout — a generic spinner produces a visible
 * reflow the moment content arrives.
 */
export function TimelineSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div data-testid="timeline-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="timeline-skeleton-item"
          className="space-y-2 border-b border-border px-4 py-3"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
