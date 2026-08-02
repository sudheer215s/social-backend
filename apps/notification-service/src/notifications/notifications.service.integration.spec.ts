import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { NotificationsService } from './notifications.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('NotificationsService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let svc: NotificationsService;
  let available = false;
  const recipient = uuidv7();
  const actor1 = uuidv7();
  const actor2 = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      svc = new NotificationsService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping notification integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('aggregates follows and dedupes events', async () => {
    if (!available) return;
    const e1 = uuidv7();
    const e2 = uuidv7();
    const r1 = await svc.processDomainEvent({
      eventId: e1,
      eventType: 'user.followed',
      payload: { followerId: actor1, followeeId: recipient },
    });
    expect(r1).toBe('handled');
    const r1b = await svc.processDomainEvent({
      eventId: e1,
      eventType: 'user.followed',
      payload: { followerId: actor1, followeeId: recipient },
    });
    expect(r1b).toBe('duplicate');

    await svc.processDomainEvent({
      eventId: e2,
      eventType: 'user.followed',
      payload: { followerId: actor2, followeeId: recipient },
    });

    const list = (await svc.listForUser(recipient)).items;
    expect(list.length).toBeGreaterThanOrEqual(1);
    const follow = list.find((n) => n.type === 'follow');
    expect(follow?.actorCount).toBeGreaterThanOrEqual(2);
    expect(await svc.unreadCount(recipient)).toBeGreaterThanOrEqual(1);

    await svc.markRead(recipient);
    expect(await svc.unreadCount(recipient)).toBe(0);
  });

  it('aggregates likes on the same post', async () => {
    if (!available) return;
    const postId = uuidv7();
    const author = uuidv7();
    await svc.processDomainEvent({
      eventId: uuidv7(),
      eventType: 'post.liked',
      payload: { postId, authorId: author, userId: actor1 },
    });
    await svc.processDomainEvent({
      eventId: uuidv7(),
      eventType: 'post.liked',
      payload: { postId, authorId: author, userId: actor2 },
    });
    const list = (await svc.listForUser(author)).items;
    const like = list.find((n) => n.type === 'like' && n.entityId === postId);
    expect(like?.actorCount).toBeGreaterThanOrEqual(2);
  });
});
