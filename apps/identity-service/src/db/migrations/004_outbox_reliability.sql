-- Idempotent for environments that already applied 003 before reliability cols.
ALTER TABLE identity.outbox ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE identity.outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE identity.outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE identity.outbox ADD COLUMN IF NOT EXISTS poisoned_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_identity_outbox_claimable
  ON identity.outbox (id)
  WHERE published_at IS NULL AND poisoned_at IS NULL;
