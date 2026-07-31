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
