import {
  hashIdempotencyParts,
  hashRequestBody,
  MemoryIdempotencyStore,
} from './idempotency';

describe('idempotency store', () => {
  it('hashes deterministically', () => {
    expect(hashIdempotencyParts('u', 'POST', '/v1/posts', 'k1')).toBe(
      hashIdempotencyParts('u', 'POST', '/v1/posts', 'k1'),
    );
    expect(hashRequestBody({ a: 1, b: 2 })).toBe(
      hashRequestBody({ b: 2, a: 1 }),
    );
  });

  it('acquires, completes, and replays', async () => {
    const store = new MemoryIdempotencyStore();
    const key = 'abc';
    const hash = hashRequestBody({ content: 'hi' });
    expect(await store.begin(key, hash)).toEqual({ outcome: 'acquired' });
    expect(await store.begin(key, hash)).toEqual({ outcome: 'in_flight' });
    await store.complete(key, hash, 201, { post: { id: '1' } });
    const replay = await store.begin(key, hash);
    expect(replay).toEqual({
      outcome: 'replay',
      status: 201,
      body: { post: { id: '1' } },
    });
  });

  it('conflicts on different body hash', async () => {
    const store = new MemoryIdempotencyStore();
    const key = 'k';
    await store.begin(key, 'h1');
    await store.complete(key, 'h1', 200, {});
    expect(await store.begin(key, 'h2')).toEqual({ outcome: 'conflict' });
  });

  it('abandons in-flight for retry after 5xx', async () => {
    const store = new MemoryIdempotencyStore();
    const key = 'k2';
    const hash = 'h';
    await store.begin(key, hash);
    await store.abandon(key);
    expect(await store.begin(key, hash)).toEqual({ outcome: 'acquired' });
  });
});
