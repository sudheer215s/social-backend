CREATE TABLE IF NOT EXISTS graph.cascade_jobs (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'user.erased'
                 CHECK (kind IN ('user.erased')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','done','failed')),
  follows_done bigint NOT NULL DEFAULT 0,
  blocks_done  bigint NOT NULL DEFAULT 0,
  mutes_done   bigint NOT NULL DEFAULT 0,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cascade_jobs_user_kind_open
  ON graph.cascade_jobs (user_id, kind)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS ix_cascade_jobs_pending
  ON graph.cascade_jobs (created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS graph.processed_events (
  consumer_group text NOT NULL,
  event_id       uuid NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
