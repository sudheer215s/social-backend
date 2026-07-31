CREATE SCHEMA IF NOT EXISTS post;

CREATE TABLE IF NOT EXISTS post.posts (
  id             uuid PRIMARY KEY,
  author_id      uuid NOT NULL,
  content        text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 280),
  media_refs     text[] NOT NULL DEFAULT '{}',
  reply_to_id    uuid,
  thread_root_id uuid,
  repost_of_id   uuid,
  like_count     bigint NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count    bigint NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  repost_count   bigint NOT NULL DEFAULT 0 CHECK (repost_count >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     text CHECK (deleted_by IS NULL OR deleted_by IN ('author', 'moderator', 'erasure'))
);

CREATE INDEX IF NOT EXISTS ix_posts_author_feed
  ON post.posts (author_id, id DESC)
  WHERE deleted_at IS NULL AND reply_to_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_posts_id_active
  ON post.posts (id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post.likes (
  post_id    uuid NOT NULL REFERENCES post.posts (id),
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_likes_user
  ON post.likes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post.schema_migrations (
  id         text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
