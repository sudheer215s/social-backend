import { createPool } from '@social/platform-db';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { applyMigrations } from '../db/migrate';
import { AuthorCascadeService } from './author-cascade.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('AuthorCascadeService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let svc: AuthorCascadeService;
  let available = false;
  const authorId = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO post.posts (id, author_id, content)
           VALUES ($1, $2, $3)`,
          [uuidv7(), authorId, `cascade post ${i}`],
        );
      }
      svc = new AuthorCascadeService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping author cascade integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('soft-deletes author posts on user.erased', async () => {
    if (!available) return;
    const eventId = uuidv7();
    const r = await svc.processDomainEvent({
      eventId,
      eventType: 'user.erased',
      payload: { userId: authorId },
    });
    expect(r).toBe('handled');
    expect(
      await svc.processDomainEvent({
        eventId,
        eventType: 'user.erased',
        payload: { userId: authorId },
      }),
    ).toBe('duplicate');

    const open = await pool.query(
      `SELECT count(*)::text AS c FROM post.posts
       WHERE author_id = $1 AND deleted_at IS NULL`,
      [authorId],
    );
    expect(Number(open.rows[0]?.c ?? 1)).toBe(0);
  });
});
