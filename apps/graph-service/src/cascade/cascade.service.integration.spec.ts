import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { CascadeService } from './cascade.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('CascadeService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let svc: CascadeService;
  let available = false;
  const userA = uuidv7();
  const userB = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      svc = new CascadeService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping cascade integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enqueues job on user.erased and deletes edges', async () => {
    if (!available) return;
    await pool.query(
      `INSERT INTO graph.follows (follower_id, followee_id) VALUES ($1,$2), ($2,$1)
       ON CONFLICT DO NOTHING`,
      [userA, userB],
    );
    await pool.query(
      `INSERT INTO graph.blocks (blocker_id, blocked_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [userA, userB],
    );
    await pool.query(
      `INSERT INTO graph.mutes (muter_id, muted_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [userB, userA],
    );

    const eventId = uuidv7();
    const r = await svc.processDomainEvent({
      eventId,
      eventType: 'user.erased',
      payload: { userId: userA },
    });
    expect(r).toBe('handled');
    expect(
      await svc.processDomainEvent({
        eventId,
        eventType: 'user.erased',
        payload: { userId: userA },
      }),
    ).toBe('duplicate');

    // Worker drains edges
    for (let i = 0; i < 10; i++) {
      await svc.runOnce();
    }

    const edges = await pool.query(
      `SELECT
         (SELECT count(*) FROM graph.follows WHERE follower_id=$1 OR followee_id=$1) AS f,
         (SELECT count(*) FROM graph.blocks WHERE blocker_id=$1 OR blocked_id=$1) AS b,
         (SELECT count(*) FROM graph.mutes WHERE muter_id=$1 OR muted_id=$1) AS m`,
      [userA],
    );
    expect(Number(edges.rows[0].f)).toBe(0);
    expect(Number(edges.rows[0].b)).toBe(0);
    expect(Number(edges.rows[0].m)).toBe(0);

    const job = await pool.query(
      `SELECT status FROM graph.cascade_jobs WHERE user_id = $1`,
      [userA],
    );
    expect(job.rows[0]?.status).toBe('done');
  });
});
