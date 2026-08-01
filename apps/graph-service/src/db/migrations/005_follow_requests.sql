CREATE TABLE IF NOT EXISTS graph.follow_requests (
  requester_id uuid NOT NULL,
  target_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CONSTRAINT no_self_follow_request CHECK (requester_id <> target_id)
);

CREATE INDEX IF NOT EXISTS ix_follow_requests_target
  ON graph.follow_requests (target_id, created_at DESC, requester_id);
