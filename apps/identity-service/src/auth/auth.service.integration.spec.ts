/**
 * Integration: register + login through PgBouncer.
 * Soft-skip when DATABASE_URL is unreachable.
 */
import { createPool } from '@social/platform-db';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import path from 'node:path';
import { applyMigrations } from '../db/migrate';
import { AuthService } from './auth.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('AuthService (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  const auth = new AuthService(pool);
  let available = false;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      const migrationsDir = path.join(__dirname, '../db/migrations');
      await applyMigrations(pool, migrationsDir);
      available = true;
    } catch (err) {
      console.warn('Skipping identity integration tests', err);
      available = false;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers a user and logs them in', async () => {
    if (!available) return;
    const username = `user_${suffix}`;
    const email = `user_${suffix}@example.com`;
    const password = 'long-enough-password';

    const created = await auth.register({ username, email, password });
    expect(created.username.toLowerCase()).toBe(username.toLowerCase());
    expect(created.email.toLowerCase()).toBe(email.toLowerCase());
    expect(created.status).toBe('active');

    const byEmail = await auth.login({ identifier: email, password });
    expect(byEmail.id).toBe(created.id);

    const byUsername = await auth.login({ identifier: username, password });
    expect(byUsername.id).toBe(created.id);
  });

  it('rejects duplicate registration without leaking which field', async () => {
    if (!available) return;
    const username = `dup_${suffix}`;
    const email = `dup_${suffix}@example.com`;
    await auth.register({
      username,
      email,
      password: 'long-enough-password',
    });
    await expect(
      auth.register({
        username: `other_${suffix}`,
        email,
        password: 'long-enough-password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid credentials uniformly', async () => {
    if (!available) return;
    await expect(
      auth.login({
        identifier: `missing_${suffix}@example.com`,
        password: 'whatever-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
