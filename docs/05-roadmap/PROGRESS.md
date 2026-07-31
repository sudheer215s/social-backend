# Progress Memory

**Last updated:** 2026-07-31
**Repo:** https://github.com/sudheer215s/social-backend
**Branch:** `main`
**HEAD:** `f486593` — docs: sync PROGRESS HEAD after memory commits

This file is the **living session handoff**. Update it at the end of every
task loop (see [`WORKFLOW.md`](./WORKFLOW.md)).

---

## Workflow (user mandate)

```
task → test → code & build → test → review → commit → update this file
```

Details: [`WORKFLOW.md`](./WORKFLOW.md) · Board: [`task-board.md`](./task-board.md)

---

## Project identity

| Item | Value |
|------|--------|
| Name | Distributed Social Media Backend |
| Stack | NestJS monorepo, pnpm, Turbo, TypeScript strict |
| Design | v2 under `docs/` (supersedes root v1 markdown) |
| Design point | 1M users, 200K DAU, ~700 RPS peak, size for 1,500 RPS |
| Git policy | Real timestamps only — no backdated contribution history |

---

## Current status

| Area | State |
|------|--------|
| **Phase** | 0 — Platform foundation |
| **Active next** | P0-T14 (Compose Redpanda/ES/OTel), P0-T11 (`platform-testing`), P0-T15 (Dockerfile) |
| **Monorepo** | `apps/hello-service` + `libs/platform-{config,telemetry,db,grpc}` |
| **CI** | `.github/workflows/ci.yml` — lint, typecheck, test, build, e2e |
| **Local infra** | Compose core healthy: Postgres, PgBouncer `:6432`, Redis |
| **Hello service** | `/`, `/health/live`, `/health/ready`; optional postgres probe if `DATABASE_URL` set |

---

## Completed tasks

| ID | Summary | Commit (approx) |
|----|---------|-----------------|
| — | Initial design + Nest scaffold | `b505cc2` |
| — | Project README | `abbf367` |
| — | Task board created | `9d13b8e` |
| P0-T01 | Strict TS + safe bootstrap | `cc83180` |
| P0-T02/T03 | pnpm monorepo + Turbo | `90194ed` |
| P0-T06 | `platform-config` (Zod fail-fast, pool cap, redaction) | `e2e2f29` |
| P0-T07/T08/T12 | `platform-telemetry` + hello health wiring | `3c29acc` |
| P0-T05/T13 | CI + Compose Postgres/PgBouncer/Redis | `0da78b4` |
| P0-T09/T10 | `platform-db` + `platform-grpc` | `a9e5a01` |

---

## Technical decisions learned while building

1. **PgBouncer rejects** `statement_timeout` (and friends) as **startup** `options`.
   Apply timeouts with **`SET LOCAL` inside `withTransaction`**, not libpq startup params.
2. **Pool max hard-capped at 10** in `platform-config` schema and `platform-db` `createPool`.
3. **Health split:** `/health/live` = process only; `/health/ready` = deps, cached 5s.
4. **Permissions:** project `.grok/config.toml` uses `permission_mode = "always-approve"` so the agent does not pause on routine tools.
5. **Config validation** at boot via `@social/platform-config` — process must not listen on invalid env.

---

## Packages

```
apps/hello-service          Nest smoke app
libs/platform-config        Zod loadConfig + configToJSON redaction
libs/platform-telemetry     Pino redaction + HealthService
libs/platform-db            pg pool, Drizzle, withTransaction, retries
libs/platform-grpc          Client policy defaults (not full channel yet)
```

---

## How to resume (next session)

```bash
cd /Users/tereishqmein/Dev/1vprojects/social-backend1
pnpm install
pnpm compose:up
cp -n .env.example .env
pnpm test
pnpm test:integration   # platform-db via PgBouncer
```

1. Read this file + [`WORKFLOW.md`](./WORKFLOW.md) + [`task-board.md`](./task-board.md).
2. Pick next `todo` on the board (prefer **P0-T14** or **P0-T15** or **P0-T11**).
3. Run the full workflow loop; update this file after commit.

---

## Open / blocked

| Item | Notes |
|------|--------|
| P0-T04 | ESLint boundaries + husky — optional polish |
| P0-T11 | `platform-testing` skeleton |
| P0-T14 | Redpanda + Elasticsearch + OTel in Compose |
| P0-T15 | Multi-stage Dockerfile for hello-service |
| P0-T16 | Documented clean-clone `pnpm dev` path |
| OTel traces E2E | Needs OTel stack (P0-T14) |
| Phase 1 | Identity service — **not started** (wait for more of Phase 0) |

---

## Session log (append-only)

### 2026-07-31
- Established monorepo, CI, Compose core, platform-config/telemetry/db/grpc, hello-service health.
- User required: autonomous edits/commands (always-approve); **no backdated commits**.
- User required workflow: **task → test → code & build → test → review → commit**.
- Added `WORKFLOW.md` + this `PROGRESS.md` + `AGENTS.md` as durable progress memory (`2b98b29`).
