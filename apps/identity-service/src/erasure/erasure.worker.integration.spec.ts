import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { ErasureWorker } from './erasure.worker';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('ErasureWorker (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let worker: ErasureWorker;
  let available = false;
  const userId = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      const u = `er_${userId.replace(/-/g, '').slice(0, 12)}`;
      await pool.query(
        `INSERT INTO identity.users
           (id, username, email, status, deactivated_at, erase_after)
         VALUES ($1, $2, $3, 'deactivated', now() - interval '31 days',
                 now() - interval '1 day')
         ON CONFLICT (id) DO UPDATE
           SET status = 'deactivated',
               erase_after = now() - interval '1 day'`,
        [userId, u, `${u}@ex.com`],
      );
      await pool.query(
        `INSERT INTO identity.credentials (user_id, password_hash)
         VALUES ($1, 'x')
         ON CONFLICT DO NOTHING`,
        [userId],
      );
      worker = new ErasureWorker(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping erasure integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('scrubs PII and marks erased when erase_after elapsed', async () => {
    if (!available) return;
    const ok = await worker.eraseOne(userId);
    expect(ok).toBe(true);

    const row = await pool.query<{
      status: string;
      email: string;
      display_name: string | null;
    }>(
      `SELECT status, email::text AS email, display_name
       FROM identity.users WHERE id = $1`,
      [userId],
    );
    expect(row.rows[0]?.status).toBe('erased');
    expect(row.rows[0]?.email).toContain('erased+');
    expect(row.rows[0]?.display_name).toBeNull();

    const creds = await pool.query(
      `SELECT 1 FROM identity.credentials WHERE user_id = $1`,
      [userId],
    );
    expect(creds.rowCount ?? 0).toBe(0);

    const outbox = await pool.query(
      `SELECT 1 FROM identity.outbox
       WHERE aggregate_id = $1 AND event_type = 'user.erased'`,
      [userId],
    );
    expect((outbox.rowCount ?? 0) >= 1).toBe(true);

    // Idempotent: second pass is a no-op
    expect(await worker.eraseOne(userId)).toBe(false);
  });
});
