import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { withTransaction } from '@social/platform-db';
import { appendOutbox } from '@social/platform-events';
import type { SessionService } from '../tokens/session.service';
import type { UpdateProfileInput } from './profile.validation';
import { USER_TOPIC } from './user-events';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarMediaId: string | null;
  visibility: string;
  status: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
}

export interface PrivateProfile extends PublicProfile {
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly pool: Pool,
    private readonly sessions?: SessionService,
  ) {}

  async getById(userId: string): Promise<PrivateProfile> {
    const row = await this.loadUser('id', userId);
    if (!row || row.status === 'erased') {
      throw new NotFoundException('User not found');
    }
    return mapPrivate(row);
  }

  async getPublicByUsername(username: string): Promise<PublicProfile> {
    const row = await this.loadUser('username', username);
    if (!row || row.status === 'erased' || row.status === 'deactivated') {
      throw new NotFoundException('User not found');
    }
    // Private accounts still return a profile shell for username lookups;
    // content visibility is enforced by post/graph services later.
    return mapPublic(row);
  }

  /**
   * Soft-deactivate account: status=deactivated, erase_after +30d, revoke sessions.
   */
  async deactivate(userId: string): Promise<void> {
    const result = await withTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE identity.users
         SET status = 'deactivated',
             deactivated_at = now(),
             erase_after = now() + interval '30 days',
             updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id`,
        [userId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        return false;
      }
      await appendOutbox(client, 'identity', {
        aggregateType: 'user',
        aggregateId: userId,
        eventType: 'user.deactivated',
        partitionKey: userId,
        topic: USER_TOPIC,
        payload: { userId, status: 'deactivated' },
      });
      return true;
    });
    if (!result) {
      throw new NotFoundException('User not found or already deactivated');
    }
    if (this.sessions) {
      await this.sessions.revokeAllForUser(userId);
    }
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<PrivateProfile> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    const add = (col: string, value: unknown) => {
      sets.push(`${col} = $${i}`);
      params.push(value);
      i += 1;
    };

    if (input.displayName !== undefined) {
      add('display_name', input.displayName);
    }
    if (input.bio !== undefined) {
      add('bio', input.bio);
    }
    if (input.avatarMediaId !== undefined) {
      add('avatar_media_id', input.avatarMediaId);
    }
    if (input.visibility !== undefined) {
      add('visibility', input.visibility);
    }
    if (input.username !== undefined) {
      add('username', input.username);
    }

    sets.push('updated_at = now()');
    params.push(userId);

    try {
      return await withTransaction(this.pool, async (client) => {
        const result = await client.query(
          `UPDATE identity.users
           SET ${sets.join(', ')}
           WHERE id = $${i} AND status <> 'erased'
           RETURNING id, username::text AS username, email::text AS email,
                     email_verified, display_name, bio, avatar_media_id,
                     visibility, status, is_verified,
                     follower_count, following_count, post_count, created_at`,
          params,
        );
        const row = result.rows[0] as UserRow | undefined;
        if (!row) {
          throw new NotFoundException('User not found');
        }
        await appendOutbox(client, 'identity', {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'user.updated',
          partitionKey: userId,
          topic: USER_TOPIC,
          payload: {
            userId: row.id,
            username: row.username,
            displayName: row.display_name,
            bio: row.bio,
            visibility: row.visibility,
            status: row.status,
            isVerified: row.is_verified,
            followerCount: Number(row.follower_count),
            createdAt: row.created_at.toISOString(),
          },
        });
        return mapPrivate(row);
      });
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (isUniqueViolation(err)) {
        throw new ConflictException('username already taken');
      }
      throw err;
    }
  }

  private async loadUser(
    by: 'id' | 'username',
    value: string,
  ): Promise<UserRow | undefined> {
    const col = by === 'id' ? 'id' : 'username';
    const result = await this.pool.query<UserRow>(
      `SELECT id, username::text AS username, email::text AS email,
              email_verified, display_name, bio, avatar_media_id,
              visibility, status, is_verified,
              follower_count, following_count, post_count, created_at
       FROM identity.users
       WHERE ${col} = $1
       LIMIT 1`,
      [value],
    );
    return result.rows[0];
  }
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  bio: string | null;
  avatar_media_id: string | null;
  visibility: string;
  status: string;
  is_verified: boolean;
  follower_count: string | number;
  following_count: string | number;
  post_count: string | number;
  created_at: Date;
}

function mapPublic(row: UserRow): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarMediaId: row.avatar_media_id,
    visibility: row.visibility,
    status: row.status,
    isVerified: row.is_verified,
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count),
    postCount: Number(row.post_count),
    createdAt: row.created_at,
  };
}

function mapPrivate(row: UserRow): PrivateProfile {
  return {
    ...mapPublic(row),
    email: row.email,
    emailVerified: row.email_verified,
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
