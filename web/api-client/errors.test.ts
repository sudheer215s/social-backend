import { describe, expect, it } from 'vitest';
import {
  ApiError,
  NetworkError,
  TimeoutError,
  apiErrorFromResponse,
  syntheticProblem,
} from './errors';

describe('ApiError (F0-T05)', () => {
  it('maps field errors from problem.errors', () => {
    const err = new ApiError(400, {
      type: 'https://example.com/validation',
      title: 'Validation failed',
      status: 400,
      errors: [
        { field: 'email', message: 'invalid' },
        { field: 'password', message: 'too short' },
      ],
    });
    expect(err.fieldErrors).toEqual({
      email: 'invalid',
      password: 'too short',
    });
    expect(err.isRetryable).toBe(false);
  });

  it('marks 5xx and 429 as retryable', () => {
    expect(new ApiError(503, syntheticProblem(503)).isRetryable).toBe(true);
    expect(new ApiError(429, syntheticProblem(429)).isRetryable).toBe(true);
    expect(new ApiError(401, syntheticProblem(401)).isRetryable).toBe(false);
  });
});

describe('apiErrorFromResponse (F0-T05)', () => {
  it('parses application/problem+json', async () => {
    const res = new Response(
      JSON.stringify({
        type: 'https://example.com/token-reuse-detected',
        title: 'Session revoked',
        status: 401,
        detail: 'reuse',
        traceId: 'abc-123',
      }),
      {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      },
    );
    const err = await apiErrorFromResponse(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.problem.type).toContain('token-reuse-detected');
    expect(err.traceId).toBe('abc-123');
  });

  it('builds a synthetic Problem for HTML/malformed bodies', async () => {
    const res = new Response('<html>bad gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' },
    });
    const err = await apiErrorFromResponse(res);
    expect(err.status).toBe(502);
    expect(err.problem.type).toBe('about:blank');
    expect(err.problem.title).toMatch(/502|Bad Gateway/);
  });

  it('does not crash on empty JSON body', async () => {
    const res = new Response('null', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const err = await apiErrorFromResponse(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});

describe('error classes (F0-T05)', () => {
  it('distinguishes NetworkError and TimeoutError', () => {
    expect(new NetworkError()).toBeInstanceOf(Error);
    expect(new TimeoutError().name).toBe('TimeoutError');
    expect(new NetworkError().name).toBe('NetworkError');
  });
});
