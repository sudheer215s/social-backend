import { randomUUID } from 'node:crypto';
import { EsClient } from './es.client';
import { SearchService } from './search.service';

const esUrl = process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200';

describe('SearchService (integration)', () => {
  const es = new EsClient(esUrl);
  let svc: SearchService;
  let available = false;
  const postId = randomUUID();
  const authorId = randomUUID();
  const userId = randomUUID();
  const unique = `zq-${Date.now().toString(36)}`;

  beforeAll(async () => {
    try {
      if (!(await es.ping())) {
        console.warn('Skipping search integration: ES not reachable');
        return;
      }
      svc = new SearchService(es);
      await svc.ensureIndices();
      available = true;
    } catch (err) {
      console.warn('Skipping search integration', err);
    }
  });

  it('indexes and finds posts and users', async () => {
    if (!available) return;

    await svc.indexPost({
      postId,
      authorId,
      content: `Hello #social ${unique} world`,
      createdAt: new Date().toISOString(),
    });
    await svc.indexUser({
      userId,
      username: `user_${unique}`,
      displayName: `Display ${unique}`,
      bio: 'integration bio',
    });

    // Force refresh for test visibility
    await fetch(`${esUrl}/posts_v1,users_v1/_refresh`, { method: 'POST' });

    const byTag = await svc.search(unique, 'post', 10);
    expect(byTag.degraded).toBe(false);
    expect(byTag.posts.some((p) => p.id === postId)).toBe(true);

    const byUser = await svc.search(`user_${unique}`, 'user', 10);
    expect(byUser.users.some((u) => u.id === userId)).toBe(true);

    await svc.deletePost(postId);
    await fetch(`${esUrl}/posts_v1/_refresh`, { method: 'POST' });
    const after = await svc.search(unique, 'post', 10);
    expect(after.posts.some((p) => p.id === postId)).toBe(false);
  });

  it('handles domain post.created events', async () => {
    if (!available) return;
    const id = randomUUID();
    const r = await svc.processDomainEvent({
      eventType: 'post.created',
      payload: {
        postId: id,
        authorId,
        content: `event-indexed ${unique}`,
        authorVisibility: 'public',
        createdAt: new Date().toISOString(),
      },
    });
    expect(r).toBe('handled');
    const skip = await svc.processDomainEvent({
      eventType: 'post.liked',
      payload: { postId: id },
    });
    expect(skip).toBe('skipped');

    const privateSkip = await svc.processDomainEvent({
      eventType: 'post.created',
      payload: {
        postId: randomUUID(),
        authorId,
        content: `private ${unique}`,
        authorVisibility: 'followers',
      },
    });
    expect(privateSkip).toBe('skipped');
  });

  it('indexes user.created and removes on user.deactivated', async () => {
    if (!available) return;
    const uid = randomUUID();
    const uname = `evt_${unique}`;
    const created = await svc.processDomainEvent({
      eventType: 'user.created',
      payload: {
        userId: uid,
        username: uname,
        displayName: 'Evt User',
        visibility: 'public',
        status: 'active',
        isVerified: false,
        followerCount: 0,
        createdAt: new Date().toISOString(),
      },
    });
    expect(created).toBe('handled');
    await fetch(`${esUrl}/users_v1/_refresh`, { method: 'POST' });
    const found = await svc.search(uname, 'user', 10);
    expect(found.users.some((u) => u.id === uid)).toBe(true);

    await svc.processDomainEvent({
      eventType: 'user.deactivated',
      payload: { userId: uid, status: 'deactivated' },
    });
    await fetch(`${esUrl}/users_v1/_refresh`, { method: 'POST' });
    const gone = await svc.search(uname, 'user', 10);
    expect(gone.users.some((u) => u.id === uid)).toBe(false);
  });
});
