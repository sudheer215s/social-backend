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
} from 'vitest';
import { tokens } from '@/api-client';
import { server } from '@/mocks/server';
import { MAX_TIMELINE_PAGES, useHomeTimeline } from './timeline';

const API = 'http://127.0.0.1:3000';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useHomeTimeline (F2-T01)', () => {
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

  it('loads the first page', async () => {
    const { result } = renderHook(() => useHomeTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.data).toHaveLength(20);
  });

  it('paginates ten pages with no duplicates and no gaps', async () => {
    const { result } = renderHook(() => useHomeTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    for (let i = 1; i < 10; i += 1) {
      await result.current.fetchNextPage();
      await waitFor(() => {
        expect(result.current.isFetchingNextPage).toBe(false);
      });
    }

    const ids = (result.current.data?.pages ?? []).flatMap((p) =>
      p.data.map((post) => post.id),
    );
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);

    // The mock feed is contiguous, so a gap would show up as a missing index.
    const indices = ids.map((id) => Number(id.replace('post_', '')));
    expect(indices).toEqual(
      Array.from({ length: 200 }, (_, i) => indices[0]! + i),
    );
  });

  it('bounds the cache so a long scroll cannot grow without limit', async () => {
    const { result } = renderHook(() => useHomeTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    for (let i = 0; i < MAX_TIMELINE_PAGES + 3; i += 1) {
      await result.current.fetchNextPage();
      await waitFor(() => {
        expect(result.current.isFetchingNextPage).toBe(false);
      });
    }

    expect(result.current.data?.pages.length).toBeLessThanOrEqual(
      MAX_TIMELINE_PAGES,
    );
  });

  it('sends the cursor back verbatim — it is opaque, never parsed', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/v1/timelines/home`, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.searchParams.get('cursor'));
        return HttpResponse.json({
          data: [],
          page: {
            next_cursor: seen.length === 1 ? 'b64==/opaque+cursor' : null,
            has_more: seen.length === 1,
          },
        });
      }),
    );

    const { result } = renderHook(() => useHomeTimeline(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false);
    });

    expect(seen[0]).toBeNull();
    expect(seen[1]).toBe('b64==/opaque+cursor');
  });

  it('stops when the backend says there is no more', async () => {
    const { result } = renderHook(() => useHomeTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The mock feed is finite; exhaust it.
    for (let i = 0; i < 40 && result.current.hasNextPage; i += 1) {
      await result.current.fetchNextPage();
      await waitFor(() => {
        expect(result.current.isFetchingNextPage).toBe(false);
      });
    }

    expect(result.current.hasNextPage).toBe(false);
    const last = result.current.data?.pages.at(-1);
    expect(last?.page.has_more).toBe(false);
    expect(last?.page.next_cursor).toBeNull();
  });
});
