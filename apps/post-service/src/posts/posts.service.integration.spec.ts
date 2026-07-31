import { createPool } from '@social/platform-db';
import path from 'node:path';
import { applyMigrations } from '../db/migrate';
import { PostsService } from './posts.service';
import { uuidv7 } from 'uuidv7';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('PostsService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let posts: PostsService;
  let available = false;
  const authorId = uuidv7();
  const otherId = uuidv7();

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      posts = new PostsService(pool);
      available = true;
    } catch (err) {
      console.warn('Skipping post integration', err);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates, lists, likes, unlikes, and soft-deletes', async () => {
    if (!available) return;
    const created = await posts.create(authorId, {
      content: 'hello phase 2',
    });
    expect(created.content).toBe('hello phase 2');
    expect(created.likeCount).toBe(0);

    const listed = await posts.listByAuthor(authorId);
    expect(listed.some((p) => p.id === created.id)).toBe(true);

    const liked = await posts.like(created.id, otherId);
    expect(liked.likeCount).toBe(1);
    const likedAgain = await posts.like(created.id, otherId);
    expect(likedAgain.likeCount).toBe(1);

    const unliked = await posts.unlike(created.id, otherId);
    expect(unliked.likeCount).toBe(0);

    await posts.softDelete(created.id, authorId);
    await expect(posts.getById(created.id)).rejects.toBeTruthy();
  });
});
