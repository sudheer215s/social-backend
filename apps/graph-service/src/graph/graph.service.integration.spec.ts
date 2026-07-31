import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { GraphService } from './graph.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('GraphService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let graph: GraphService;
  let available = false;
  const a = uuidv7();
  const b = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      graph = new GraphService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping graph integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('follows, lists, blocks (severs follows), unblocks', async () => {
    if (!available) return;
    await graph.follow(a, b);
    await expect(graph.isFollowing(a, b)).resolves.toBe(true);
    const following = await graph.listFollowing(a);
    expect(following.some((x) => x.userId === b)).toBe(true);
    const followers = await graph.listFollowers(b);
    expect(followers.some((x) => x.userId === a)).toBe(true);

    await graph.block(b, a);
    await expect(graph.isFollowing(a, b)).resolves.toBe(false);
    await expect(graph.follow(a, b)).rejects.toBeTruthy();

    const blockEvents = await pool.query(
      `SELECT event_type FROM graph.outbox
       WHERE event_type IN ('user.blocked','user.unblocked')
         AND payload->>'blockerId' = $1`,
      [b],
    );
    expect(blockEvents.rows.some((r) => r.event_type === 'user.blocked')).toBe(
      true,
    );

    await graph.unmute(b, a); // no-op if not muted
    await graph.mute(b, a);
    const muteEvents = await pool.query(
      `SELECT event_type FROM graph.outbox
       WHERE event_type = 'user.muted' AND payload->>'muterId' = $1`,
      [b],
    );
    expect(muteEvents.rowCount ?? 0).toBeGreaterThanOrEqual(1);
    await graph.unmute(b, a);

    await graph.unblock(b, a);
    await graph.follow(a, b);
    await expect(graph.isFollowing(a, b)).resolves.toBe(true);

    await graph.unfollow(a, b);
    await expect(graph.isFollowing(a, b)).resolves.toBe(false);
  });
});
