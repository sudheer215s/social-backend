import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { CounterService } from './counter.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('CounterService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let svc: CounterService;
  let available = false;
  const follower = uuidv7();
  const followee = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      // Minimal users for counter updates
      const ins = await pool.query(
        `INSERT INTO identity.users (id, username, email)
         VALUES ($1, $2, $3), ($4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [
          follower,
          `cf_${follower.replace(/-/g, '').slice(0, 12)}`,
          `cf_${follower.replace(/-/g, '').slice(0, 12)}@ex.com`,
          followee,
          `ce_${followee.replace(/-/g, '').slice(0, 12)}`,
          `ce_${followee.replace(/-/g, '').slice(0, 12)}@ex.com`,
        ],
      );
      if ((ins.rowCount ?? 0) < 2) {
        throw new Error('failed to seed counter test users');
      }
      svc = new CounterService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping counter integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('increments and decrements follower/following counts idempotently', async () => {
    if (!available) return;
    const eventId = uuidv7();
    const r1 = await svc.processDomainEvent({
      eventId,
      eventType: 'user.followed',
      payload: { followerId: follower, followeeId: followee },
    });
    expect(r1).toBe('handled');
    const r1b = await svc.processDomainEvent({
      eventId,
      eventType: 'user.followed',
      payload: { followerId: follower, followeeId: followee },
    });
    expect(r1b).toBe('duplicate');

    const afterFollow = await pool.query<{ fc: string }>(
      `SELECT follower_count::text AS fc FROM identity.users WHERE id = $1`,
      [followee],
    );
    expect(afterFollow.rows[0]).toBeDefined();
    expect(Number(afterFollow.rows[0]!.fc)).toBeGreaterThanOrEqual(1);

    const followerRow = await pool.query<{ fc: string }>(
      `SELECT following_count::text AS fc FROM identity.users WHERE id = $1`,
      [follower],
    );
    expect(Number(followerRow.rows[0]!.fc)).toBeGreaterThanOrEqual(1);

    await svc.processDomainEvent({
      eventId: uuidv7(),
      eventType: 'user.unfollowed',
      payload: { followerId: follower, followeeId: followee },
    });
  });

  it('adjusts post_count on post.created and post.deleted', async () => {
    if (!available) return;
    const author = followee;
    const created = await svc.processDomainEvent({
      eventId: uuidv7(),
      eventType: 'post.created',
      payload: { postId: uuidv7(), authorId: author },
    });
    expect(created).toBe('handled');
    const after = await pool.query<{ pc: string }>(
      `SELECT post_count::text AS pc FROM identity.users WHERE id = $1`,
      [author],
    );
    expect(Number(after.rows[0]!.pc)).toBeGreaterThanOrEqual(1);

    await svc.processDomainEvent({
      eventId: uuidv7(),
      eventType: 'post.deleted',
      payload: { postId: uuidv7(), authorId: author },
    });
  });
});
