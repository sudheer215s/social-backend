import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password';
import type { LoginInput, RegisterInput } from './validation';

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  visibility: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(private readonly pool: Pool) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const userId = uuidv7();

    try {
      return await withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO identity.users (id, username, email, display_name)
           VALUES ($1, $2, $3, $4)`,
          [userId, input.username, input.email, input.displayName ?? null],
        );
        await client.query(
          `INSERT INTO identity.credentials (user_id, password_hash)
           VALUES ($1, $2)`,
          [userId, passwordHash],
        );
        await client.query(
          `INSERT INTO identity.user_settings (user_id) VALUES ($1)`,
          [userId],
        );

        const row = await client.query<{
          id: string;
          username: string;
          email: string;
          email_verified: boolean;
          display_name: string | null;
          visibility: string;
          status: string;
          created_at: Date;
        }>(
          `SELECT id, username::text AS username, email::text AS email,
                  email_verified, display_name, visibility, status, created_at
           FROM identity.users WHERE id = $1`,
          [userId],
        );
        const u = row.rows[0];
        if (!u) {
          throw new Error('user insert vanished');
        }
        return mapUser(u);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Do not reveal which field collided (anti-enumeration).
        throw new ConflictException('username or email already registered');
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<PublicUser> {
    const identifier = input.identifier.trim();
    const lookup = await this.pool.query<{
      id: string;
      username: string;
      email: string;
      email_verified: boolean;
      display_name: string | null;
      visibility: string;
      status: string;
      created_at: Date;
      password_hash: string;
      locked_until: Date | null;
    }>(
      `SELECT u.id, u.username::text AS username, u.email::text AS email,
              u.email_verified, u.display_name, u.visibility, u.status, u.created_at,
              c.password_hash, c.locked_until
       FROM identity.users u
       JOIN identity.credentials c ON c.user_id = u.id
       WHERE u.email = $1 OR u.username = $1
       LIMIT 1`,
      [identifier],
    );

    const row = lookup.rows[0];
    const hash = row?.password_hash ?? (await getDummyPasswordHash());
    const ok = await verifyPassword(hash, input.password);

    if (
      !row ||
      !ok ||
      row.status !== 'active' ||
      (row.locked_until && row.locked_until > new Date())
    ) {
      // Uniform failure surface (anti-enumeration).
      throw new UnauthorizedException('Invalid credentials');
    }

    return mapUser(row);
  }
}

function mapUser(row: {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  visibility: string;
  status: string;
  created_at: Date;
}): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
    visibility: row.visibility,
    status: row.status,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
