'use client';

/**
 * Deleted posts, blocked authors, and suspended accounts all arrive as
 * hydration tombstones. This component takes no props on purpose: there is
 * nothing it *could* leak, and distinguishing the cases would give away
 * exactly what the backend's 404-not-403 policy conceals.
 * @see docs/frontend/04-modules/feature-modules.md — `post`
 */
export function DeletedPostTombstone() {
  return (
    <article
      data-testid="post-tombstone"
      className="rounded-DEFAULT border border-border bg-bg-subtle px-4 py-3 text-sm text-fg-muted"
    >
      This post is unavailable
    </article>
  );
}
