-- Drop any content CHECK constraints so pure reposts can use content=''.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'post'
      AND rel.relname = 'posts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%content%'
  LOOP
    EXECUTE format('ALTER TABLE post.posts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE post.posts
  ADD CONSTRAINT posts_content_check CHECK (
    char_length(content) <= 280
    AND (
      repost_of_id IS NOT NULL
      OR char_length(content) BETWEEN 1 AND 280
    )
  );

-- Thread / direct-reply read paths (partial: live rows only).
CREATE INDEX IF NOT EXISTS ix_posts_thread
  ON post.posts (thread_root_id, id)
  WHERE deleted_at IS NULL AND thread_root_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_posts_reply
  ON post.posts (reply_to_id, id)
  WHERE deleted_at IS NULL AND reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_posts_repost_of
  ON post.posts (repost_of_id, id DESC)
  WHERE deleted_at IS NULL AND repost_of_id IS NOT NULL;

-- One pure (no-comment) repost per author per original.
CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_pure_repost
  ON post.posts (author_id, repost_of_id)
  WHERE deleted_at IS NULL
    AND repost_of_id IS NOT NULL
    AND content = '';
