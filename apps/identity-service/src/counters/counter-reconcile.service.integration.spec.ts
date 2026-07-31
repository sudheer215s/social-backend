import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { CounterReconcileService } from './counter-reconcile.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('CounterReconcileService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let svc: CounterReconcileService;
  let available = false;
  const userId = uuidv7();
  const other = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      // Ensure graph/post schemas exist (other services own them)
      await pool.query(`CREATE SCHEMA IF NOT EXISTS graph`);
      await pool.query(`CREATE SCHEMA IF NOT EXISTS post`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS graph.follows (
          follower_id uuid NOT NULL,
          followee_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (follower_id, followee_id)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS post.posts (
          id uuid PRIMARY KEY,
          author_id uuid NOT NULL,
          content text NOT NULL DEFAULT '',
          reply_to_id uuid,
          deleted_at timestamptz
        )`);

      const u = `rq_${userId.replace(/-/g, '').slice(0, 12)}`;
      await pool.query(
        `INSERT INTO identity.users (id, username, email, follower_count, following_count, post_count)
         VALUES ($1, $2, $3, 99, 99, 99)
         ON CONFLICT (id) DO UPDATE SET follower_count=99, following_count=99, post_count=99`,
        [userId, u, `${u}@ex.com`],
      );
      await pool.query(
        `INSERT INTO graph.follows (follower_id, followee_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [other, userId],
      );
      await pool.query(
        `INSERT INTO post.posts (id, author_id, content) VALUES ($1,$2,'hi')
         ON CONFLICT DO NOTHING`,
        [uuidv7(), userId],
      );
      svc = new CounterReconcileService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping reconcile integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('repairs drifted counters from source tables', async () => {
    if (!available) return;
    const fixed = await svc.reconcileUser(userId);
    expect(fixed).toBe(true);
    const row = await pool.query<{
      fc: string;
      g: string;
      p: string;
    }>(
      `SELECT follower_count::text AS fc, following_count::text AS g, post_count::text AS p
       FROM identity.users WHERE id = $1`,
      [userId],
    );
    expect(Number(row.rows[0]!.fc)).toBe(1);
    expect(Number(row.rows[0]!.g)).toBe(0);
    expect(Number(row.rows[0]!.p)).toBeGreaterThanOrEqual(1);
  });
});
