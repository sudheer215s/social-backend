import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { tokens } from '@/api-client';
import { server } from '@/mocks/server';
import type { Post } from './timeline';
import { NEW_POSTS_MAX, useNewPostsCount } from './timeline';

const API = 'http://127.0.0.1:3000';

function post(id: string): Post {
  return {
    id,
    author: { id: 'user_1', username: 'alice' },
    content: id,
    created_at: '2026-08-04T10:00:00.000Z',
    like_count: 0,
    reply_count: 0,
    repost_count: 0,
  };
}

/** Serves a fixed head page and counts how often it is asked for. */
function headHandler(ids: string[], onHit?: () => void) {
  return http.get(`${API}/v1/timelines/home`, () => {
    onHit?.();
    return HttpResponse.json({
      data: ids.map(post),
      page: { next_cursor: 'next', has_more: true },
    });
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useNewPostsCount (F2-T04)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    tokens.set('timeline-test-token', 600);
  });

  afterEach(() => {
    server.resetHandlers();
    tokens.clear();
  });

  afterAll(() => {
    server.close();
  });

  it('reports nothing new while the known top post is still the newest', async () => {
    server.use(headHandler(['post_a', 'post_b', 'post_c']));

    const { result } = renderHook(() => useNewPostsCount('post_a'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });
    expect(result.current.count).toBe(0);
  });

  it('counts only the posts that arrived above the known top post', async () => {
    server.use(headHandler(['new_1', 'new_2', 'post_a', 'post_b']));

    const { result } = renderHook(() => useNewPostsCount('post_a'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });
  });

  it('caps at a page when the known top post has fallen off the head', async () => {
    server.use(
      headHandler(Array.from({ length: NEW_POSTS_MAX }, (_, i) => `new_${i}`)),
    );

    const { result } = renderHook(() => useNewPostsCount('post_a'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.count).toBe(NEW_POSTS_MAX);
    });
  });

  it('does not poll before the timeline has a top post to compare against', async () => {
    const onHit = vi.fn();
    server.use(headHandler(['post_a'], onHit));

    const { result } = renderHook(() => useNewPostsCount(undefined), {
      wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onHit).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it('does not disturb the infinite timeline cache', async () => {
    server.use(headHandler(['new_1', 'post_a']));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useNewPostsCount('post_a'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.count).toBe(1);
    });
    expect(client.getQueryData(['timeline', 'home'])).toBeUndefined();
  });
});
