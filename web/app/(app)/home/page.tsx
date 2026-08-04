'use client';

import { TimelineList } from '@/features/timeline';

/**
 * Authenticated home — the screen that is 65% of traffic.
 * Auth guard lives in (app)/layout via RequireAuth.
 * @see docs/frontend/01-architecture.md §7
 */
export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Home</h1>
      <TimelineList />
    </div>
  );
}
