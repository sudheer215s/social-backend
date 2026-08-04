import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Post } from '@/data/queries/timeline';
import { PostCard } from './PostCard';

const basePost: Post = {
  id: 'post_1',
  author: { id: 'user_1', username: 'alice', display_name: 'Alice' },
  content: 'Hello timeline',
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  like_count: 3,
  reply_count: 1,
  repost_count: 0,
  liked: false,
  reposted: false,
};

describe('PostCard (F2-T02)', () => {
  it('renders the author, content, and a relative timestamp', () => {
    render(<PostCard post={basePost} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('Hello timeline')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('falls back to the username when there is no display name', () => {
    const { display_name: _omitted, ...author } = basePost.author;
    render(<PostCard post={{ ...basePost, author }} />);

    expect(screen.getAllByText(/alice/)).not.toHaveLength(0);
  });

  it('exposes an accessible absolute time alongside the relative one', () => {
    render(<PostCard post={basePost} />);

    const time = screen.getByText('2h');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', basePost.created_at);
  });

  it('renders counts, including zero', () => {
    render(<PostCard post={basePost} />);

    expect(screen.getByTestId('post-like-count')).toHaveTextContent('3');
    expect(screen.getByTestId('post-reply-count')).toHaveTextContent('1');
    expect(screen.getByTestId('post-repost-count')).toHaveTextContent('0');
  });

  it('renders one tombstone for every unavailable reason', () => {
    const reasons = ['deleted', 'blocked', 'suspended'];
    const rendered = reasons.map((reason) => {
      const view = render(
        <PostCard
          post={
            {
              ...basePost,
              unavailable: true,
              unavailable_reason: reason,
            } as Post
          }
        />,
      );
      const text = view.container.textContent;
      view.unmount();
      return text;
    });

    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toMatch(/this post is unavailable/i);
  });

  it('leaks neither content nor author through a tombstone', () => {
    render(<PostCard post={{ ...basePost, unavailable: true } as Post} />);

    expect(screen.queryByText('Hello timeline')).toBeNull();
    expect(screen.queryByText('@alice')).toBeNull();
  });

  it('is memoised — it is the most-rendered component in the app', () => {
    expect((PostCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });
});
