import { describe, expect, it } from 'vitest';
import { backoffMs, shouldRetry } from './retry';

describe('retry policy (F0-T06)', () => {
  it('retries GET on 503', () => {
    expect(
      shouldRetry({
        method: 'GET',
        status: 503,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(true);
  });

  it('does not retry POST without idempotency key', () => {
    expect(
      shouldRetry({
        method: 'POST',
        status: 503,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(false);
  });

  it('retries POST with idempotency key', () => {
    expect(
      shouldRetry({
        method: 'POST',
        status: 503,
        hasIdempotencyKey: true,
        attempt: 0,
      }),
    ).toBe(true);
  });

  it('never retries 4xx except 429', () => {
    expect(
      shouldRetry({
        method: 'GET',
        status: 400,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(false);
    expect(
      shouldRetry({
        method: 'GET',
        status: 429,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(true);
  });

  it('retries PUT/DELETE on 503', () => {
    expect(
      shouldRetry({
        method: 'PUT',
        status: 503,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(true);
    expect(
      shouldRetry({
        method: 'DELETE',
        status: 503,
        hasIdempotencyKey: false,
        attempt: 0,
      }),
    ).toBe(true);
  });

  it('stops after max attempts', () => {
    expect(
      shouldRetry({
        method: 'GET',
        status: 503,
        hasIdempotencyKey: false,
        attempt: 2,
        maxAttempts: 2,
      }),
    ).toBe(false);
  });
});

describe('backoffMs full jitter (F0-T06)', () => {
  it('stays within [0, base*2^attempt]', () => {
    for (let i = 0; i < 50; i++) {
      const ms = backoffMs(2, 200, 2000, () => 0.999);
      expect(ms).toBeLessThanOrEqual(800);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not synchronise 100 clients to the same delay', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(backoffMs(3, 200, 5000));
    }
    // With full jitter, collisions are possible but 100 identical is not.
    expect(values.size).toBeGreaterThan(10);
  });
});
