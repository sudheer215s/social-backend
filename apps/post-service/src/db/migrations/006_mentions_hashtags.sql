CREATE TABLE IF NOT EXISTS post.hashtags (
  id          uuid PRIMARY KEY,
  tag         text NOT NULL UNIQUE,
  tag_display text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post.post_hashtags (
  post_id    uuid NOT NULL REFERENCES post.posts (id),
  hashtag_id uuid NOT NULL REFERENCES post.hashtags (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, hashtag_id)
);

CREATE INDEX IF NOT EXISTS ix_post_hashtags_tag
  ON post.post_hashtags (hashtag_id, post_id DESC);

CREATE TABLE IF NOT EXISTS post.mentions (
  post_id           uuid NOT NULL REFERENCES post.posts (id),
  raw_username      text NOT NULL,
  mentioned_user_id uuid,
  resolved_at       timestamptz,
  PRIMARY KEY (post_id, raw_username)
);

CREATE INDEX IF NOT EXISTS ix_mentions_unresolved
  ON post.mentions (post_id)
  WHERE mentioned_user_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_mentions_user
  ON post.mentions (mentioned_user_id)
  WHERE mentioned_user_id IS NOT NULL;
