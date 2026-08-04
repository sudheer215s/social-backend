'use client';

import { memo } from 'react';
import type { Post } from '@/data/queries/timeline';
import { DeletedPostTombstone } from './DeletedPostTombstone';
import { useRelativeTime } from './useRelativeTime';

export type PostCardProps = {
  post: Post;
  /** Position in the *logical* feed — the DOM only holds a window of it. */
  posInSet?: number;
  setSize?: number;
};

/**
 * The most-rendered component in the app: memoised, no inline object or
 * function props, and timestamps driven by one shared interval.
 * @see docs/frontend/04-modules/feature-modules.md — `post`
 */
function PostCardImpl({ post, posInSet, setSize }: PostCardProps) {
  const relative = useRelativeTime(post.created_at);

  if (post.unavailable) return <DeletedPostTombstone />;

  const name = post.author.display_name ?? post.author.username;

  return (
    <article
      data-post-id={post.id}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      className="border-b border-border px-4 py-3"
    >
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium text-fg">{name}</span>
        <span className="text-fg-muted">@{post.author.username}</span>
        <span aria-hidden="true" className="text-fg-muted">
          ·
        </span>
        <time dateTime={post.created_at} className="text-fg-muted">
          {relative}
        </time>
      </div>

      <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{post.content}</p>

      <div className="mt-2 flex gap-6 text-xs text-fg-muted">
        <span data-testid="post-reply-count">
          <span className="sr-only">Replies: </span>
          {post.reply_count}
        </span>
        <span data-testid="post-repost-count">
          <span className="sr-only">Reposts: </span>
          {post.repost_count}
        </span>
        <span data-testid="post-like-count">
          <span className="sr-only">Likes: </span>
          {post.like_count}
        </span>
      </div>
    </article>
  );
}

export const PostCard = memo(PostCardImpl);
