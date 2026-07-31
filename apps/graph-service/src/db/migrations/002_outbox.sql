CREATE TABLE IF NOT EXISTS graph.outbox (
  id              uuid PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  event_type      text NOT NULL,
  partition_key   text NOT NULL,
  topic           text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE INDEX IF NOT EXISTS ix_graph_outbox_unpublished
  ON graph.outbox (created_at)
  WHERE published_at IS NULL;
