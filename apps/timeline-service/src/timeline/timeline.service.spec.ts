import { TimelineService } from './timeline.service';
import type { TimelineStore } from './timeline.store';

describe('TimelineService.backfillOnFollow', () => {
  it('no-ops when follower timeline is cold', async () => {
    const store = {
      exists: jest.fn().mockResolvedValue(false),
      fanoutIfExists: jest.fn(),
    } as unknown as TimelineStore;
    const svc = new TimelineService(store, 'http://graph', 'http://post');
    const n = await svc.backfillOnFollow('follower', 'followee');
    expect(n).toBe(0);
    expect(store.fanoutIfExists).not.toHaveBeenCalled();
  });

  it('injects recent posts when timeline exists', async () => {
    const store = {
      exists: jest.fn().mockResolvedValue(true),
      fanoutIfExists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    } as unknown as TimelineStore;

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        posts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      }),
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const svc = new TimelineService(store, 'http://graph', 'http://post');
      const n = await svc.backfillOnFollow('follower', 'followee', 50);
      expect(n).toBe(2);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://post/v1/posts?authorId=followee&limit=50',
      );
      expect(store.fanoutIfExists).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('TimelineService.hydratePosts', () => {
  it('filters blocked and muted authors fail-closed', async () => {
    const store = {} as TimelineStore;
    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/posts/batch')) {
        return {
          ok: true,
          json: async () => ({
            posts: [
              { id: 'p1', authorId: 'good' },
              { id: 'p2', authorId: 'blocked-user' },
              { id: 'p3', authorId: 'muted-user' },
              { id: 'p4', authorId: 'good2' },
            ],
          }),
        };
      }
      if (url.includes('related-ids')) {
        return {
          ok: true,
          json: async () => ({ ids: ['blocked-user'] }),
        };
      }
      if (url.includes('/mutes/')) {
        return {
          ok: true,
          json: async () => ({ ids: ['muted-user'] }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const svc = new TimelineService(store, 'http://graph', 'http://post');
      const { posts, filtered } = await svc.hydratePosts('viewer', [
        'p1',
        'p2',
        'p3',
        'p4',
      ]);
      expect(filtered).toBe(2);
      expect(posts).toHaveLength(2);
      expect((posts[0] as { id: string }).id).toBe('p1');
      expect((posts[1] as { id: string }).id).toBe('p4');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('TimelineService.fanoutPost large account', () => {
  it('skips follower fan-out for large authors', async () => {
    const store = {
      fanoutIfExists: jest.fn().mockResolvedValue(true),
    } as unknown as TimelineStore;
    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/count')) {
        return { ok: true, json: async () => ({ count: 50_000 }) };
      }
      if (url.includes('/ids')) {
        return { ok: true, json: async () => ({ ids: ['f1', 'f2'] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const svc = new TimelineService(store, 'http://graph', 'http://post');
      const n = await svc.fanoutPost('celeb', 'post1');
      expect(n).toBe(1); // self only
      expect(store.fanoutIfExists).toHaveBeenCalledTimes(1);
      expect(store.fanoutIfExists).toHaveBeenCalledWith('celeb', 'post1');
    } finally {
      globalThis.fetch = original;
    }
  });
});
