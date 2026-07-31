CREATE SCHEMA IF NOT EXISTS graph;

CREATE TABLE IF NOT EXISTS graph.follows (
  follower_id uuid NOT NULL,
  followee_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS ix_follows_following
  ON graph.follows (follower_id, created_at DESC, followee_id);

CREATE INDEX IF NOT EXISTS ix_follows_followers
  ON graph.follows (followee_id, created_at DESC, follower_id);

CREATE TABLE IF NOT EXISTS graph.blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS ix_blocks_blocked
  ON graph.blocks (blocked_id, blocker_id);

CREATE TABLE IF NOT EXISTS graph.mutes (
  muter_id uuid NOT NULL,
  muted_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CONSTRAINT no_self_mute CHECK (muter_id <> muted_id)
);

CREATE TABLE IF NOT EXISTS graph.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
