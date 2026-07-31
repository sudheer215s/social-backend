# Component Design — `identity-service`

**Kind:** gRPC + Kafka consumer
**Owns:** `users`, `credentials`, `sessions`, `user_settings`, `email_tokens`, `outbox`, `processed_events`
**Scales on:** request rate
**Depends on:** Postgres (`identity_db`), Redis (cache), Kafka, email provider

---

## 1. Responsibility

The root of identity. Every other service references `user_id` and treats it as opaque; this service is the only one that can create, describe, or destroy one.

| Owns | Explicitly not |
|---|---|
| Registration, email verification | Authorization decisions about *content* (post-service and graph-service own those) |
| Credential storage and verification | Follow relationships (graph-service) |
| **Token issuance and revocation** | Session *transport* (api-gateway verifies, never signs) |
| Profile and settings | Notification delivery |
| Account lifecycle: active → deactivated → erased | |
| Publishing `user.*` events | |

### Why auth and profile are one service

They share a transaction boundary — registration writes a credential, a profile, default settings, and an outbox row atomically. Splitting them would make the single most important write in the system a distributed transaction, to save nothing at this scale.

**The seam, for when it is worth splitting** (system design §12.2): `credentials`, `sessions`, and `email_tokens` are keyed only by `user_id` and are never joined to `users` outside of registration. Profile reads outnumber auth operations roughly 50:1, so the split is along that read/write asymmetry, and it is a matter of moving three tables.

---

## 2. Data model

```sql
CREATE TABLE users (
  id              uuid        PRIMARY KEY,               -- UUIDv7
  username        citext      NOT NULL UNIQUE,           -- case-insensitive
  username_lower  text        GENERATED ALWAYS AS (lower(username::text)) STORED,
  email           citext      NOT NULL UNIQUE,
  email_verified  boolean     NOT NULL DEFAULT false,
  display_name    text,
  bio             text,
  avatar_media_id text,                                  -- opaque; never a URL
  visibility      text        NOT NULL DEFAULT 'public'
                              CHECK (visibility IN ('public','followers')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','deactivated','suspended','erased')),
  is_verified     boolean     NOT NULL DEFAULT false,    -- badge, not email
  follower_count  bigint      NOT NULL DEFAULT 0 CHECK (follower_count  >= 0),
  following_count bigint      NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  post_count      bigint      NOT NULL DEFAULT 0 CHECK (post_count      >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  erase_after     timestamptz,
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  CONSTRAINT bio_length      CHECK (char_length(bio) <= 500)
);
CREATE INDEX ix_users_active ON users (id) WHERE status = 'active';
CREATE INDEX ix_users_erase  ON users (erase_after) WHERE erase_after IS NOT NULL;

-- Separated so a profile SELECT * can never return a password hash.
CREATE TABLE credentials (
  user_id            uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash      text        NOT NULL,               -- argon2id
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts    int         NOT NULL DEFAULT 0,
  locked_until       timestamptz
);

CREATE TABLE sessions (
  id                 uuid        PRIMARY KEY,            -- = JWT `sid`
  family_id          uuid        NOT NULL,               -- rotation chain
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash bytea       NOT NULL,               -- sha256, never the token
  prev_token_hash    bytea,                              -- reuse detection
  user_agent         text,
  ip_hash            bytea,                              -- hashed: it is PII
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text
);
CREATE UNIQUE INDEX uq_sessions_token ON sessions (refresh_token_hash);
CREATE INDEX ix_sessions_family ON sessions (family_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_user   ON sessions (user_id)   WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_expiry ON sessions (expires_at);

CREATE TABLE user_settings (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notify_on_follow    boolean NOT NULL DEFAULT true,
  notify_on_like      boolean NOT NULL DEFAULT true,
  notify_on_reply     boolean NOT NULL DEFAULT true,
  notify_on_mention   boolean NOT NULL DEFAULT true,
  notify_on_repost    boolean NOT NULL DEFAULT true,
  email_digest        text    NOT NULL DEFAULT 'weekly'
                              CHECK (email_digest IN ('off','daily','weekly')),
  discoverable_by_email boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_tokens (
  token_hash bytea       PRIMARY KEY,                    -- sha256; plaintext only in the email
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('verify_email','reset_password','change_email')),
  payload    jsonb,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX ix_email_tokens_user ON email_tokens (user_id, purpose) WHERE used_at IS NULL;
```

Design notes:

- **`citext` for username and email.** Case-insensitive uniqueness at the database level, so `Alice` and `alice` cannot both be registered. Enforcing this in application code has a TOCTOU race under concurrency.
- **Credentials in a separate table.** A profile query physically cannot return a password hash, however careless the `SELECT`.
- **`ip_hash`, not `ip_address`.** v1 stored raw `INET` in `refresh_tokens`. IP addresses are PII under GDPR; the only operational need is "is this the same device", which a hash satisfies.
- **Token hashes as primary keys.** A database dump does not yield usable tokens.
- **`erase_after`** drives the staged-deletion job (§7), indexed partially so the job's scan is cheap.

---

## 3. Token architecture

Resolves review F2 and F3. Rationale in ADR-0010.

### Access token — EdDSA (Ed25519), 10 minutes

```json
{
  "iss": "https://api.example.com",
  "aud": "api",
  "sub": "0190f2c1-...",     "sid": "0190f2c2-...",
  "jti": "0190f2c3-...",     "iat": 1753900000, "exp": 1753900600,
  "scope": ["user"]
}
```
Header carries `kid`. **No profile data in the token** — a username in a claim is stale the moment the user renames, and every consumer of that claim then serves stale data. Tokens carry identity, not state.

### Key management

Two active keys at all times: one signing (`kid=current`), one still-verifiable (`kid=previous`). Rotation every 90 days, or immediately on suspected compromise:

```
t0        generate next → publish to JWKS (verify-only)
t0 + 10m  JWKS caches everywhere have refreshed → promote next to signing
t0 + 20m  retire previous (beyond any live access token's 10-min lifetime)
```

Rotation is a non-event because every step is additive and each wait exceeds the relevant cache/token lifetime. Private keys live in the secret store, never in a ConfigMap or image.

### Refresh token — 30 days, rotating, with reuse detection

```
POST /v1/auth/refresh { refresh_token }

1  h = sha256(token); look up sessions by refresh_token_hash
2  not found  → 401
3  found, revoked → 401
4  found, h matches prev_token_hash  → REUSE DETECTED
     revoke every session in family_id
     emit security.token_reuse_detected + page
     → 401, user must re-authenticate
5  valid → rotate:
     prev_token_hash = current; current = sha256(new); last_used_at = now
     issue new access + new refresh (same family_id)
```

Step 4 is the mechanism v1 lacked entirely. Rotation alone does not detect theft; keeping the *previous* hash does. If an attacker steals a refresh token and uses it, the legitimate client's next refresh presents the now-previous token — which trips reuse detection and severs the whole family. Either party's use burns the other, so theft is always detected within one refresh cycle.

### Revocation

| Event | Effect | Latency |
|---|---|---|
| Logout | Session revoked; `sid` added to the Redis revocation set (TTL 10 min) | Immediate for refresh, ≤10 min for access |
| Logout all | Every session for the user revoked | same |
| Password change | Every session revoked | same |
| Reuse detected | Family revoked | Immediate |
| Suspension | Every session revoked; `canView` denies all content | Immediate |

The revocation set stays tiny — entries expire with the access-token lifetime, so it holds only sessions revoked in the last 10 minutes.

---

## 4. Flows

### 4.1 Registration
```
validate → check username/email availability (advisory only; the unique index decides)
BEGIN
  INSERT users (status='active', email_verified=false)
  INSERT credentials (argon2id: m=19456 KiB, t=2, p=1)
  INSERT user_settings (defaults)
  INSERT outbox (user.created)
COMMIT                                    -- unique violation → 409, mapped by column
issue session → { access, refresh }
enqueue verification email (24 h single-use token)
```
Unverified accounts may read but not post, follow, or like — friction placed where it stops spam without blocking a first look at the product.

### 4.2 Login
```
fetch user + credentials by email (single query)
if locked_until > now  → 423 Locked
verify argon2id                            -- always run, even for unknown emails
on failure: failed_attempts++              -- lock 15 min at 10
            → 401 "invalid credentials"    -- identical for unknown email and wrong password
on success: reset attempts; create session; return tokens
```

Two anti-enumeration properties: the hash is verified against a dummy digest even when the email is unknown (so timing does not leak existence), and both failure paths return a byte-identical response.

### 4.3 Password reset
Missing entirely from v1 despite being an exposed endpoint (review F4).
```
POST /auth/password/forgot { email }
  → always 202, always the same body and timing, regardless of existence
  → if the account exists: single-use token, 1 h expiry, hash stored
  → rate limited per IP and per account

POST /auth/password/reset { token, new_password }
  → look up by sha256(token); reject if used or expired
  → BEGIN: mark token used · update hash · revoke ALL sessions · outbox(user.password_changed) · COMMIT
  → notify the user by email that the password changed
```
Revoking every session on reset is the point of the flow: if the reset was triggered by a compromise, leaving the attacker's session alive defeats it.

### 4.4 Deactivation and erasure
See system design §8.6. `DELETE /v1/users/me` sets `status='deactivated'`, `erase_after = now() + 30 days`, revokes all sessions, and publishes `user.deactivated`. The `erasure-worker` job picks it up on day 30.

---

## 5. gRPC surface

```protobuf
service IdentityService {
  rpc GetUser            (GetUserRequest)            returns (User);
  rpc GetUserByUsername  (GetUserByUsernameRequest)  returns (User);
  rpc GetUsersByIds      (GetUsersByIdsRequest)      returns (GetUsersByIdsResponse);  // ≤100
  rpc GetSettings        (GetSettingsRequest)        returns (UserSettings);
  rpc GetSettingsBatch   (GetSettingsBatchRequest)   returns (GetSettingsBatchResponse);
  rpc UpdateProfile      (UpdateProfileRequest)      returns (User);
  rpc CheckUsersExist    (CheckUsersExistRequest)    returns (CheckUsersExistResponse);
  rpc ResolveUsernames   (ResolveUsernamesRequest)   returns (ResolveUsernamesResponse);
  // auth
  rpc Register (RegisterRequest) returns (AuthResponse);
  rpc Login    (LoginRequest)    returns (AuthResponse);
  rpc Refresh  (RefreshRequest)  returns (AuthResponse);
  rpc Revoke   (RevokeRequest)   returns (RevokeResponse);
  rpc IssueRealtimeTicket (IssueRealtimeTicketRequest) returns (RealtimeTicket);
}
```

`GetUsersByIds` **caps at 100** and returns found users only — the caller must handle absence rather than assume positional correspondence (review G4). There are **no** `IncrementFollowerCount` RPCs; counters move only through events (§6).

Every batch response is a map keyed by ID, not a positionally-aligned array. Positional alignment is the kind of contract that breaks silently when one element is missing.

---

## 6. Events

### Published (via outbox)
| Event | Payload | Consumers |
|---|---|---|
| `user.created` | id, username, display_name, visibility | search, graph |
| `user.updated` | id, changed fields | search, cache invalidators |
| `user.visibility_changed` | id, visibility | **search (purge from public index)**, timeline |
| `user.deactivated` | id | search, timeline, notification |
| `user.erased` | id | all — **compaction tombstone** |
| `user.password_changed` | id | (audit) |

### Consumed
| Topic | Group | Handler |
|---|---|---|
| `social.graph.v1` | `identity-counters` | `user.followed/unfollowed` → adjust `follower_count`/`following_count` |
| `social.post.v1` | `identity-counters` | `post.created/deleted` → adjust `post_count` |

Counters are **only** adjusted here, inside the transaction that writes the dedupe row:

```sql
BEGIN;
INSERT INTO processed_events (consumer_group, event_id) VALUES ('identity-counters', $1)
  ON CONFLICT DO NOTHING;
-- 0 rows affected ⇒ already applied ⇒ ROLLBACK and commit the offset
UPDATE users SET follower_count = follower_count + $2 WHERE id = $3;
COMMIT;
```

This is the whole answer to review C1. v1 offered both a non-idempotent gRPC increment and an event-driven sync, and retries under the first would double-count — with retries explicitly enabled on `UNAVAILABLE`. Here the dedupe row makes replay a no-op, and `counter-reconcile` bounds any residual drift nightly.

---

## 7. Jobs

| Job | Cadence | Action |
|---|---|---|
| `session-sweep` | hourly | Delete sessions past `expires_at + 7d`; delete used/expired email tokens |
| `erasure-worker` | 5 min | For `erase_after < now()`: overwrite PII, delete credentials/sessions, publish `user.erased`, set `status='erased'` |
| `counter-reconcile` | daily 03:00 | Recompute all three counters from graph/post services; emit `counter_drift`; correct |
| `unverified-cleanup` | daily | Delete accounts unverified after 30 days with zero activity |

`counter-reconcile` needs source-of-truth counts from services that own them, so it reads via gRPC batch (`graph.CountFollowers`, `post.CountPostsByAuthor`) rather than reaching across database boundaries.

---

## 8. Caching

| Key | TTL | Invalidation |
|---|---|---|
| `u:p:{user_id}` (profile hash) | 1 h | Deleted on update and on `user.updated` |
| `u:n:{username}` → id | 1 h | Deleted on rename — **both** old and new |
| `u:s:{user_id}` (settings) | 5 min | Deleted on update |
| `auth:revoked:{sid}` | 10 min | Expires with the access token |

Cache-aside, delete-on-write. Single-flight on miss for hot profiles (a popular account's cache expiring must not send a thundering herd at Postgres). Negative cache 404s for 30 s to blunt username enumeration.

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Postgres unavailable | Login/register/refresh fail (503). Profile reads serve from cache with `X-Degraded`. |
| Redis unavailable | Profile reads go to Postgres (higher latency); revocation checks **fail open** for ≤10 min |
| Kafka unavailable | Writes succeed; outbox depth grows; alerts at 10K/60 s |
| Email provider down | Registration succeeds unverified; send retried with backoff, dead-lettered after 24 h |
| Key store unreachable at boot | **Refuse to start** — a service that cannot sign must not serve |

The revocation fail-open is a considered risk: a revoked session stays valid for at most the access-token lifetime. Failing closed would make Redis a hard dependency of every authenticated request in the system.

---

## 10. Deployment & SLIs

```yaml
replicas: 3                        # HPA 3–8 on CPU 70%
resources: { requests: {cpu: 250m, memory: 384Mi}, limits: {cpu: 1000m, memory: 512Mi} }
NODE_OPTIONS: --max-old-space-size=384
pdb: minAvailable: 2
```
Argon2id at `m=19456, t=2, p=1` costs ~50 ms and ~19 MB per verification. At 20 logins/s that is ~1 CPU-second/s — **login is CPU-bound and must be load-tested as such**, since it is the one endpoint here that does not behave like an I/O-bound Node service.

| SLI | Target |
|---|---|
| `GetUser` p99 | < 20 ms (cached) / < 60 ms (cold) |
| `GetUsersByIds` (100) p99 | < 50 ms |
| Login p99 | < 300 ms (dominated by argon2id) |
| Token reuse detections | 0 expected; any occurrence pages |
| Counter drift | < 0.1% |

---

## 11. Testing

- **Unit:** token claims and expiry; reuse-detection state machine; argon2 parameters; username/email validation.
- **Integration:** concurrent registration with the same username (unique index must win); refresh rotation under concurrent requests from two devices; JWKS rotation with in-flight tokens signed by the previous key; counter consumer replaying the same event 100× (count must not move).
- **Security:** login timing must not differ measurably between unknown-email and wrong-password; reset tokens single-use; no PII in logs (asserted by a log-scrubbing test).
- **Load:** login at 50 RPS sustained to size argon2 CPU.

## 12. Open items

| # | Item | Default |
|---|---|---|
| 1 | MFA (TOTP) | Not v2; `credentials` extends cleanly |
| 2 | OAuth/social login | Not v2; needs an `identities` table |
| 3 | Passkeys/WebAuthn | Preferred long-term direction over MFA |
| 4 | Email change flow | v2, reusing `email_tokens` with `purpose='change_email'` |
