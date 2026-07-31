# Progress Memory

**Last updated:** 2026-07-31  
**Repo:** https://github.com/sudheer215s/social-backend  
**Branch:** `main`  
**HEAD:** (set after commit)

## Workflow
```
task → test → code & build → test → review → commit → update this file
```

## Current status

| Area | State |
|------|--------|
| **Phase** | **1 — Identity** |
| **Active next** | P1-T05 email verify/reset; P1-T06 api-gateway; Redis revocation set |
| **Frontend** | Deferred |

## Phase 1 completed

| ID | What |
|----|------|
| P1-T01 | Schema + migrator |
| P1-T02 | Register/login argon2id |
| P1-T03 | EdDSA (Ed25519) access tokens + JWKS (`/.well-known/jwks.json`) |
| P1-T04 | Refresh rotation + reuse detection (family revoke commits before 401) |

### Token surface
- `POST /v1/auth/register` → `{ user, tokens }`
- `POST /v1/auth/login` → `{ user, tokens }`
- `POST /v1/auth/refresh` `{ refreshToken }`
- `POST /v1/auth/logout` `{ refreshToken }`
- `GET /.well-known/jwks.json` and `GET /v1/auth/jwks`
- Access TTL 10m, refresh 30d; `sid` in access token

### Important bugfix
Reuse detection must **COMMIT family revoke before throwing 401**. Throwing inside `withTransaction` rolled back the revoke.

## Resume
```bash
pnpm compose:up
pnpm --filter @social/identity-service test
pnpm --filter @social/identity-service test:integration
pnpm dev:identity
```

## Session log
### 2026-07-31
- P1-T03/T04 tokens + refresh reuse detection
