import { createPool } from '@social/platform-db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import path from 'node:path';
import { applyMigrations } from '../db/migrate';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { EmailTokenService } from '../auth/email-token.service';
import { ConsoleEmailAdapter } from '../email/console-email.adapter';
import { createDevKeyRing } from '../tokens/jwt-keys';
import { SessionService } from '../tokens/session.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('UsersService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let users: UsersService;
  let auth: AuthService;
  let available = false;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      await applyMigrations(pool, path.join(__dirname, '../db/migrations'));
      users = new UsersService(pool);
      const keys = await createDevKeyRing();
      auth = new AuthService(
        pool,
        new SessionService(pool, keys),
        new EmailTokenService(pool),
        new ConsoleEmailAdapter(),
      );
      available = true;
    } catch (err) {
      console.warn('Skipping users integration', err);
      available = false;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('updates profile fields and reads public username', async () => {
    if (!available) return;
    const registered = await auth.register({
      username: `prof_${suffix}`,
      email: `prof_${suffix}@example.com`,
      password: 'long-enough-password',
      displayName: 'Before',
    });

    const updated = await users.updateProfile(registered.user.id, {
      displayName: 'After Name',
      bio: 'hello bio',
      visibility: 'followers',
      avatarMediaId: 'media_abc',
    });
    expect(updated.displayName).toBe('After Name');
    expect(updated.bio).toBe('hello bio');
    expect(updated.visibility).toBe('followers');
    expect(updated.avatarMediaId).toBe('media_abc');
    expect(updated.email).toBe(registered.user.email);

    const pub = await users.getPublicByUsername(`prof_${suffix}`);
    expect(pub.id).toBe(registered.user.id);
    expect(pub.displayName).toBe('After Name');
    expect((pub as { email?: string }).email).toBeUndefined();
  });

  it('rejects username conflicts and missing users', async () => {
    if (!available) return;
    await auth.register({
      username: `taken_${suffix}`,
      email: `taken_${suffix}@example.com`,
      password: 'long-enough-password',
    });
    const other = await auth.register({
      username: `otherp_${suffix}`,
      email: `otherp_${suffix}@example.com`,
      password: 'long-enough-password',
    });
    await expect(
      users.updateProfile(other.user.id, { username: `taken_${suffix}` }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      users.getPublicByUsername(`missing_${suffix}`),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
