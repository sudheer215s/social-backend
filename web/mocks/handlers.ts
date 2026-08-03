/**
 * MSW handlers — network-layer mocks for integration tests and local dev.
 * @see docs/frontend/05-cross-cutting/testing.md §5
 * @see FE-0011
 */
import { http, HttpResponse } from 'msw';

const API = 'http://127.0.0.1:3000';

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
