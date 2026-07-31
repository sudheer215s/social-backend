-- Refresh lookup + family scans (P1-T03/T04).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_refresh_hash
  ON identity.sessions (refresh_token_hash);

CREATE INDEX IF NOT EXISTS ix_sessions_family
  ON identity.sessions (family_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_sessions_expiry
  ON identity.sessions (expires_at);
