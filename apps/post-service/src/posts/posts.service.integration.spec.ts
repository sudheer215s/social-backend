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
    expect(listed.posts.some((p) => p.id === created.id)).toBe(true);
    expect(listed.page.has_more).toBe(false);

    const liked = await posts.like(created.id, otherId);
    expect(liked.likeCount).toBe(1);
    const likedAgain = await posts.like(created.id, otherId);
    expect(likedAgain.likeCount).toBe(1);

    const withViewer = await posts.getById(created.id, otherId);
    expect(withViewer.viewerLiked).toBe(true);
    expect(withViewer.viewerReposted).toBe(false);
    const states = await posts.getViewerStates(otherId, [created.id]);
    expect(states[created.id]?.liked).toBe(true);

    const likeOutbox = await pool.query<{ event_type: string; c: string }>(
      `SELECT event_type, count(*)::text AS c FROM post.outbox
       WHERE aggregate_id = $1 AND event_type = 'post.liked'
       GROUP BY event_type`,
      [created.id],
    );
    expect(Number(likeOutbox.rows[0]?.c ?? 0)).toBe(1);

    const unliked = await posts.unlike(created.id, otherId);
    expect(unliked.likeCount).toBe(0);

    await posts.softDelete(created.id, authorId);
    await expect(posts.getById(created.id)).rejects.toBeTruthy();

    const delOutbox = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM post.outbox
       WHERE aggregate_id = $1 AND event_type = 'post.deleted'`,
      [created.id],
    );
    expect(Number(delOutbox.rows[0]?.c ?? 0)).toBe(1);
  });

  it('replies, threads, and reposts', async () => {
    if (!available) return;
    const root = await posts.create(authorId, { content: 'root post' });
    const reply = await posts.create(otherId, {
      content: 'a reply',
      replyToId: root.id,
    });
    expect(reply.replyToId).toBe(root.id);
    expect(reply.threadRootId).toBe(root.id);

    const nested = await posts.create(authorId, {
      content: 'nested',
      replyToId: reply.id,
    });
    expect(nested.threadRootId).toBe(root.id);

    const parent = await posts.getById(root.id);
    expect(parent.replyCount).toBe(1);

    const replies = await posts.listReplies(root.id);
    expect(replies.some((p) => p.id === reply.id)).toBe(true);

    const thread = await posts.getThread(nested.id);
    expect(thread.root?.id).toBe(root.id);
    expect(thread.posts.some((p) => p.id === nested.id)).toBe(true);

    const replyEvents = await pool.query(
      `SELECT event_type FROM post.outbox
       WHERE aggregate_id = $1 AND event_type = 'post.replied'`,
      [reply.id],
    );
    expect(replyEvents.rowCount ?? 0).toBeGreaterThanOrEqual(1);

    const pure = await posts.create(otherId, { repostOfId: root.id });
    expect(pure.repostOfId).toBe(root.id);
    expect(pure.content).toBe('');
    const afterRepost = await posts.getById(root.id);
    expect(afterRepost.repostCount).toBe(1);

    await expect(
      posts.create(otherId, { repostOfId: root.id }),
    ).rejects.toBeTruthy();

    const quote = await posts.create(otherId, {
      content: 'quote take',
      repostOfId: root.id,
    });
    expect(quote.content).toBe('quote take');
    expect(quote.repostOfId).toBe(root.id);

    // Repost-of-repost collapses to original
    const chained = await posts.create(authorId, { repostOfId: pure.id });
    expect(chained.repostOfId).toBe(root.id);

    const repostEvents = await pool.query(
      `SELECT event_type FROM post.outbox
       WHERE aggregate_id = $1 AND event_type = 'post.reposted'`,
      [pure.id],
    );
    expect(repostEvents.rowCount ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('returns bounded recent ids across authors', async () => {
    if (!available) return;
    const a1 = uuidv7();
    const a2 = uuidv7();
    const p1 = await posts.create(a1, { content: 'from a1 one' });
    const p2 = await posts.create(a1, { content: 'from a1 two' });
    const p3 = await posts.create(a2, { content: 'from a2 one' });
    const ids = await posts.recentIdsByAuthors({
      authorIds: [a1, a2],
      perAuthor: 10,
      limit: 50,
    });
    expect(ids).toEqual(expect.arrayContaining([p1.id, p2.id, p3.id]));
    expect(ids[0]! >= ids[ids.length - 1]!).toBe(true); // DESC by UUIDv7 time
  });

  it('stores hashtags and unresolved mentions when identity is down', async () => {
    if (!available) return;
    const created = await posts.create(authorId, {
      content: 'hey @nobody_xyz_abc #CoolTag and #cooltag',
    });
    const mentions = await pool.query<{
      raw_username: string;
      mentioned_user_id: string | null;
    }>(
      `SELECT raw_username, mentioned_user_id FROM post.mentions WHERE post_id = $1`,
      [created.id],
    );
    expect(mentions.rowCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(mentions.rows[0]?.raw_username).toBe('nobody_xyz_abc');

    const tags = await pool.query(
      `SELECT h.tag FROM post.hashtags h
       JOIN post.post_hashtags ph ON ph.hashtag_id = h.id
       WHERE ph.post_id = $1`,
      [created.id],
    );
    expect(tags.rows.some((r: { tag: string }) => r.tag === 'cooltag')).toBe(
      true,
    );
  });
});
