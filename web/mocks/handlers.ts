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
