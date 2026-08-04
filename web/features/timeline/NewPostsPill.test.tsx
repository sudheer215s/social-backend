import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NEW_POSTS_MAX } from '@/data/queries/timeline';
import { NewPostsPill } from './NewPostsPill';

describe('NewPostsPill (F2-T04)', () => {
  it('stays out of the way when nothing is new', () => {
    render(<NewPostsPill count={0} onShow={vi.fn()} />);

    expect(screen.queryByTestId('new-posts-pill')).toBeNull();
  });

  it('counts a single new post in the singular', () => {
    render(<NewPostsPill count={1} onShow={vi.fn()} />);

    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(
      '1 new post',
    );
  });

  it('counts several new posts', () => {
    render(<NewPostsPill count={4} onShow={vi.fn()} />);

    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(
      '4 new posts',
    );
  });

  // A full page of new posts means we lost track of how many there really are.
  it('caps the count rather than claiming a precise number it cannot know', () => {
    render(<NewPostsPill count={NEW_POSTS_MAX} onShow={vi.fn()} />);

    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(
      `${NEW_POSTS_MAX}+ new posts`,
    );
  });

  it('only loads the new posts when the user asks', async () => {
    const onShow = vi.fn();
    render(<NewPostsPill count={3} onShow={onShow} />);

    expect(onShow).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByTestId('new-posts-pill'));

    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('is a real button so the keyboard reaches it', () => {
    render(<NewPostsPill count={3} onShow={vi.fn()} />);

    expect(screen.getByRole('button', { name: /3 new posts/i })).toBeVisible();
  });
});
