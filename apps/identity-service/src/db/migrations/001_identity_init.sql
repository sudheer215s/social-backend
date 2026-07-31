-- Identity schema (P1-T01). Applied through PgBouncer-safe migrator.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.users (
  id              uuid        PRIMARY KEY,
  username        citext      NOT NULL UNIQUE,
  email           citext      NOT NULL UNIQUE,
  email_verified  boolean     NOT NULL DEFAULT false,
  display_name    text,
  bio             text,
  avatar_media_id text,
  visibility      text        NOT NULL DEFAULT 'public'
                              CHECK (visibility IN ('public', 'followers')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'deactivated', 'suspended', 'erased')),
  is_verified     boolean     NOT NULL DEFAULT false,
  follower_count  bigint      NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  following_count bigint      NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  post_count      bigint      NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  erase_after     timestamptz,
  CONSTRAINT username_format CHECK (username::text ~ '^[a-zA-Z0-9_]{3,30}$'),
  CONSTRAINT bio_length CHECK (bio IS NULL OR char_length(bio) <= 500)
);

CREATE INDEX IF NOT EXISTS ix_users_active
  ON identity.users (id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS identity.credentials (
  user_id             uuid PRIMARY KEY REFERENCES identity.users (id) ON DELETE CASCADE,
  password_hash       text NOT NULL,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts     int NOT NULL DEFAULT 0,
  locked_until        timestamptz
);

CREATE TABLE IF NOT EXISTS identity.sessions (
  id                 uuid PRIMARY KEY,
  family_id          uuid NOT NULL,
  user_id            uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  refresh_token_hash bytea NOT NULL,
  prev_token_hash    bytea,
  user_agent         text,
  ip_hash            bytea,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);

CREATE INDEX IF NOT EXISTS ix_sessions_user
  ON identity.sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS identity.user_settings (
  user_id uuid PRIMARY KEY REFERENCES identity.users (id) ON DELETE CASCADE,
  locale  text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'UTC',
  notify_email boolean NOT NULL DEFAULT true,
  notify_push  boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS identity.email_tokens (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_email_tokens_user
  ON identity.email_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS identity.schema_migrations (
  id         text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
