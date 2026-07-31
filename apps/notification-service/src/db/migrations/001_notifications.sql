CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.notifications (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  type         text NOT NULL CHECK (type IN
                 ('follow','like','reply','mention','repost')),
  entity_type  text,
  entity_id    uuid,
  actor_ids    uuid[] NOT NULL DEFAULT '{}',
  actor_count  int NOT NULL DEFAULT 1,
  group_key    text NOT NULL,
  group_window bigint NOT NULL,
  is_read      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_group
  ON notification.notifications (user_id, group_key, group_window);

CREATE INDEX IF NOT EXISTS ix_notif_user_feed
  ON notification.notifications (user_id, id DESC);

CREATE INDEX IF NOT EXISTS ix_notif_unread
  ON notification.notifications (user_id) WHERE is_read = false;

CREATE TABLE IF NOT EXISTS notification.processed_events (
  consumer_group text NOT NULL,
  event_id       uuid NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);

CREATE TABLE IF NOT EXISTS notification.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
