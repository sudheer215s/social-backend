/**
 * TimelineList against the real request pipeline + MSW. The sibling
 * TimelineList.test.tsx stubs the query hook to pin rendering rules; this one
 * exists so data-layer/mock drift fails a test instead of reaching a browser.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { degradation, tokens } from '@/api-client';
import { degradedTimelineHandler } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { TimelineList } from './TimelineList';

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderTimeline() {
  return render(
    <Wrapper>
      <TimelineList />
    </Wrapper>,
  );
}

function renderedIds(): string[] {
  return Array.from(document.querySelectorAll('[data-post-id]')).map(
    (el) => el.getAttribute('data-post-id') ?? '',
  );
}

describe('TimelineList against MSW (F2-T03)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    tokens.set('timeline-test-token', 600);
    degradation._reset();
  });

  afterEach(() => {
    server.resetHandlers();
    tokens.clear();
    degradation._reset();
  });

  afterAll(() => {
    server.close();
  });

  it('replaces skeletons with the first page from the server', async () => {
    renderTimeline();

    expect(
      screen.getAllByTestId('timeline-skeleton-item').length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByRole('feed')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('timeline-skeleton')).toBeNull();
    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe('post_0');
  });

  it('appends the next page without dropping or duplicating posts', async () => {
    renderTimeline();
    await waitFor(() => {
      expect(screen.getByRole('feed')).toBeInTheDocument();
    });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(renderedIds()).toHaveLength(40);
    });
    const ids = renderedIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[20]).toBe('post_20');
  });

  it('names what is stale when the server flags the response degraded', async () => {
    server.use(degradedTimelineHandler);

    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId('degraded-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('Some posts may be missing.')).toBeInTheDocument();
    // Degraded is not an error: the posts the server did return still render.
    expect(renderedIds()).toHaveLength(20);
  });

  it('offers a retry instead of an empty screen when the server fails', async () => {
    server.use(
      http.get('http://127.0.0.1:3000/v1/timelines/home', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500 },
          {
            status: 500,
            headers: { 'content-type': 'application/problem+json' },
          },
        ),
      ),
    );

    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId('timeline-error')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});
