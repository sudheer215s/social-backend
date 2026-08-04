/**
 * MSW handlers — network-layer mocks for integration tests and local dev.
 * @see docs/frontend/05-cross-cutting/testing.md §5
 * @see FE-0011
 */
import { http, HttpResponse } from 'msw';

const API = 'http://127.0.0.1:3000';

const TIMELINE_FEED_SIZE = 250;

const timelineFeed = Array.from({ length: TIMELINE_FEED_SIZE }, (_, i) => ({
  id: `post_${i}`,
  author: {
    id: `user_${i % 7}`,
    username: `user_${i % 7}`,
    display_name: `User ${i % 7}`,
  },
  content: `Mock post ${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
  like_count: i % 5,
  reply_count: i % 3,
  repost_count: i % 2,
  liked: false,
  reposted: false,
}));

function problem(title: string, status: number) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function requireBearer(request: Request) {
  const auth = request.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? null : problem('Unauthorized', 401);
}

function parseLimit(url: URL): number {
  const raw = Number(url.searchParams.get('limit') ?? 20);
  if (!Number.isFinite(raw)) return 20;
  return Math.min(Math.max(Math.trunc(raw), 1), 100);
}

/** Cursors are opaque to the client; only this mock server may decode one. */
function decodeCursor(raw: string): number | null {
  try {
    const index = Number(atob(raw));
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}

export const handlers = [
  http.post(`${API}/v1/auth/refresh`, () => {
    return HttpResponse.json({
      access_token: 'msw-access-token',
      expires_in: 600,
      token_type: 'Bearer',
    });
  }),

  http.post(`${API}/v1/auth/login`, async ({ request }) => {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };
    if (body.email === 'bad@example.com') {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid credentials',
          status: 401,
        },
        {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    return HttpResponse.json({
      access_token: 'msw-login-token',
      expires_in: 600,
      token_type: 'Bearer',
    });
  }),

  http.post(`${API}/v1/auth/register`, async () => {
    return HttpResponse.json(
      {
        access_token: 'msw-register-token',
        expires_in: 600,
        token_type: 'Bearer',
      },
      { status: 201 },
    );
  }),

  http.post(`${API}/v1/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API}/v1/auth/password/forgot`, async ({ request }) => {
    const body = (await request.json()) as { email?: string };
    // Unconditional 202 is deliberate: any branch on account existence
    // re-introduces enumeration.
    if (body.email === 'ratelimited@example.com') {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Too many requests',
          status: 429,
          retryAfter: 60,
        },
        {
          status: 429,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    return new HttpResponse(null, { status: 202 });
  }),

  http.post(`${API}/v1/auth/password/reset`, async ({ request }) => {
    const body = (await request.json()) as {
      token?: string;
      password?: string;
    };
    if (body.token === 'expired-token') {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid or expired token',
          status: 400,
        },
        {
          status: 400,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API}/v1/auth/verify-email`, async ({ request }) => {
    const body = (await request.json()) as { token?: string };
    if (body.token === 'expired-token') {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid or expired token',
          status: 400,
        },
        {
          status: 400,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/v1/me`, ({ request }) => {
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
        },
        {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    return HttpResponse.json({
      id: 'user_msw_1',
      username: 'msw_user',
      display_name: 'MSW User',
      email_verified: true,
    });
  }),

  http.get(`${API}/v1/timelines/home`, ({ request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;

    const url = new URL(request.url);
    const limit = parseLimit(url);
    const cursorParam = url.searchParams.get('cursor');
    let start = 0;
    if (cursorParam !== null) {
      const decoded = decodeCursor(cursorParam);
      if (decoded === null) return problem('Invalid cursor', 400);
      start = decoded;
    }
    const endIndex = start + limit;
    const data = timelineFeed.slice(start, endIndex);
    const has_more = endIndex < timelineFeed.length;
    return HttpResponse.json({
      data,
      page: {
        next_cursor: has_more ? btoa(String(endIndex)) : null,
        has_more,
      },
    });
  }),
];

/** Handler variants for tests that need an unverified user. */
export const unverifiedMeHandler = http.get(`${API}/v1/me`, ({ request }) => {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return HttpResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401 },
      {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      },
    );
  }
  return HttpResponse.json({
    id: 'user_msw_1',
    username: 'msw_user',
    display_name: 'MSW User',
    email_verified: false,
  });
});

/** Handler variant that always serves the first page, flagged as degraded. */
export const degradedTimelineHandler = http.get(
  `${API}/v1/timelines/home`,
  ({ request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;

    const limit = parseLimit(new URL(request.url));
    const data = timelineFeed.slice(0, limit);
    return HttpResponse.json(
      {
        data,
        page: {
          next_cursor: btoa(String(limit)),
          has_more: true,
        },
      },
      { headers: { 'x-degraded': 'timeline-pull' } },
    );
  },
);
