CREATE TABLE IF NOT EXISTS identity.abuse_reports (
  id           uuid PRIMARY KEY,
  reporter_id  uuid NOT NULL,
  target_type  text NOT NULL CHECK (target_type IN ('user', 'post')),
  target_id    uuid NOT NULL,
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 64),
  details      text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_abuse_reports_reporter
  ON identity.abuse_reports (reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_abuse_reports_target
  ON identity.abuse_reports (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_abuse_reports_open
  ON identity.abuse_reports (created_at DESC)
  WHERE status = 'open';
