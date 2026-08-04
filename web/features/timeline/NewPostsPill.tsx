'use client';

import { NEW_POSTS_MAX } from '@/data/queries/timeline';

export type NewPostsPillProps = {
  count: number;
  onShow: () => void;
};

function label(count: number): string {
  if (count >= NEW_POSTS_MAX) return `${NEW_POSTS_MAX}+ new posts`;
  return count === 1 ? '1 new post' : `${count} new posts`;
}

/**
 * New posts are announced, never injected: a list that grows under a reading
 * thumb loses their place and their tap target.
 * @see docs/frontend/03-flows.md §4
 */
export function NewPostsPill({ count, onShow }: NewPostsPillProps) {
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none sticky top-2 z-10 flex justify-center">
      <button
        type="button"
        data-testid="new-posts-pill"
        onClick={onShow}
        className="pointer-events-auto min-h-tap rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow"
      >
        {label(count)}
      </button>
    </div>
  );
}
