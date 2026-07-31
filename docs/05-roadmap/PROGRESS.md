# Progress Memory

**Last updated:** 2026-07-31  
**Repo:** https://github.com/sudheer215s/social-backend  
**Branch:** `main`  
**HEAD:** `4ebc55b` — feat(P1-T01/T02): identity-service schema, register, and login

## Workflow
```
task → test → code & build → test → review → commit → update this file
```

## Current status

| Area | State |
|------|--------|
| **Phase** | **1 — Identity** (in progress) |
| **Active next** | P1-T03 EdDSA/JWKS, P1-T04 refresh rotation |
| **Frontend** | Deferred (docs under `docs/frontend/` untracked) |
| **Compose** | Full local stack (Postgres/PgBouncer/Redis/Redpanda/ES/Jaeger/OTel) |

## Phase 0
Core complete (P0-T04 eslint boundaries optional). Platform libs + hello + CI + Compose + Dockerfile + dev-setup.

## Phase 1 done this session
| ID | What |
|----|------|
| P1-T01 | `identity` SQL schema + forward migrator |
| P1-T02 | Register/login argon2id, anti-enumeration, integration tests |

### Identity service
- App: `apps/identity-service` (Nest HTTP for now; gRPC later with gateway)
- Routes: `POST /v1/auth/register`, `POST /v1/auth/login`, `/health/*`
- Default port: **3001**
- Migrations: `apps/identity-service/src/db/migrations/001_identity_init.sql`
- Run: `DATABASE_URL=... SERVICE_NAME=identity-service ... pnpm --filter @social/identity-service dev`

### Tests
```bash
pnpm --filter @social/identity-service test
pnpm --filter @social/identity-service test:integration
```

## Next
1. Access tokens (EdDSA) + JWKS
2. Refresh rotation + reuse detection
3. api-gateway shell

## Session log
### 2026-07-31
- Backend-only focus; frontend deferred
- Phase 1 identity schema + register/login landed
