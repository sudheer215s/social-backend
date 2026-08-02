-- API enforces ≤280 grapheme clusters; DB allows multi-codepoint graphemes
-- (e.g. ZWJ emoji) up to a generous code-point budget plus a hard byte cap.
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
    octet_length(content) <= 4000
    AND char_length(content) <= 1120
    AND (
      repost_of_id IS NOT NULL
      OR char_length(content) >= 1
    )
  );
