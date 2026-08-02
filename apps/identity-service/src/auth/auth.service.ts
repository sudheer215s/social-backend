import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './validation';
import { SessionService, type TokenPair } from '../tokens/session.service';
import type { EmailPort } from '../email/email.port';
import { EmailTokenService } from './email-token.service';
import { USER_TOPIC } from '../users/user-events';

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

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

const PUBLIC_FORGOT_BODY = {
  message: 'If an account exists for that email, a reset link has been sent.',
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly sessions: SessionService,
    private readonly emailTokens: EmailTokenService,
    private readonly email: EmailPort,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    const userId = uuidv7();

    try {
      const result = await withTransaction(this.pool, async (client) => {
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
        const verifyToken = await this.emailTokens.issue(
          userId,
          'verify_email',
          client,
        );
        const tokens = await this.sessions.issueSession(
          userId,
          { emailVerified: u.email_verified },
          client,
        );
        // No email/PII in the public search index payload
        await appendOutbox(client, 'identity', {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.created',
          partitionKey: userId,
          topic: USER_TOPIC,
          payload: {
            userId: u.id,
            username: u.username,
            displayName: u.display_name,
            bio: null,
            visibility: u.visibility,
            status: u.status,
            isVerified: false,
            followerCount: 0,
            createdAt: u.created_at.toISOString(),
          },
        });
        return { user: mapUser(u), tokens, verifyToken };
      });

      await this.email.send({
        to: result.user.email,
        subject: 'Verify your email',
        text: `Your verification token: ${result.verifyToken}`,
      });

      return { user: result.user, tokens: result.tokens };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('username or email already registered');
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
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
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.sessions.issueSession(row.id, {
      emailVerified: row.email_verified,
    });
    return { user: mapUser(row), tokens };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.sessions.refresh(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revokeByRefreshToken(refreshToken);
  }

  async verifyEmail(input: VerifyEmailInput): Promise<{ verified: true }> {
    const consumed = await this.emailTokens.consume(
      input.token,
      'verify_email',
    );
    if (!consumed) {
      throw new BadRequestException('Invalid or expired verification token');
    }
    await this.pool.query(
      `UPDATE identity.users
       SET email_verified = true, updated_at = now()
       WHERE id = $1`,
      [consumed.userId],
    );
    return { verified: true };
  }

  /**
   * Always returns the same body (anti-enumeration). Timing is best-effort;
   * production rate limits belong at the gateway.
   */
  async forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<typeof PUBLIC_FORGOT_BODY> {
    const email = input.email.trim();
    const found = await this.pool.query<{ id: string; email: string }>(
      `SELECT id, email::text AS email FROM identity.users
       WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email],
    );
    const user = found.rows[0];
    if (user) {
      const token = await this.emailTokens.issue(user.id, 'reset_password');
      await this.email.send({
        to: user.email,
        subject: 'Reset your password',
        text: `Your password reset token: ${token}`,
      });
    }
    return PUBLIC_FORGOT_BODY;
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ reset: true }> {
    const consumed = await this.emailTokens.consume(
      input.token,
      'reset_password',
    );
    if (!consumed) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await hashPassword(input.newPassword);
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE identity.credentials
         SET password_hash = $2,
             password_updated_at = now(),
             failed_attempts = 0,
             locked_until = NULL
         WHERE user_id = $1`,
        [consumed.userId, passwordHash],
      );
      await this.sessions.revokeAllForUser(consumed.userId, client);
    });

    const user = await this.pool.query<{ email: string }>(
      `SELECT email::text AS email FROM identity.users WHERE id = $1`,
      [consumed.userId],
    );
    const to = user.rows[0]?.email;
    if (to) {
      await this.email.send({
        to,
        subject: 'Your password was changed',
        text: 'If you did not change your password, contact support immediately.',
      });
    }

    return { reset: true };
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
