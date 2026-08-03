-- Admin review metadata for abuse reports
ALTER TABLE identity.abuse_reports
  ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT ''
    CHECK (char_length(review_note) <= 500);

CREATE INDEX IF NOT EXISTS ix_abuse_reports_status_created
  ON identity.abuse_reports (status, created_at DESC);
