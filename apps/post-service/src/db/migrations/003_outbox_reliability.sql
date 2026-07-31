ALTER TABLE post.outbox ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE post.outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE post.outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE post.outbox ADD COLUMN IF NOT EXISTS poisoned_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_post_outbox_claimable
  ON post.outbox (id)
  WHERE published_at IS NULL AND poisoned_at IS NULL;
