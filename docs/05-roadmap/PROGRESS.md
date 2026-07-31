# Progress Memory

**Last updated:** 2026-07-31  
**Repo:** https://github.com/sudheer215s/social-backend  
**Branch:** `main`  
**HEAD:** `0ebb23e` — feat(P0-T11/T15): platform-testing helpers and hello Dockerfile

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
| **Active next** | P0-T14 (Compose Redpanda/ES/OTel), P0-T16 (clean-clone path), P0-T04 (eslint boundaries) |
| **Monorepo** | `apps/hello-service` + `libs/platform-{config,telemetry,db,grpc,testing}` |
| **CI** | `.github/workflows/ci.yml` — lint, typecheck, test, build, e2e |
| **Local infra** | Compose core: Postgres, PgBouncer `:6432`, Redis |
| **Container** | `docker/Dockerfile.hello-service` multi-stage distroless via `pnpm deploy` |
| **Hello service** | `/`, `/health/live`, `/health/ready`; postgres probe when `DATABASE_URL` set |

---

## Completed tasks

| ID | Summary | Notes |
|----|---------|--------|
| P0-T01 | Strict TS baseline | |
| P0-T02/T03 | pnpm monorepo + Turbo | |
| P0-T05 | GitHub Actions CI | |
| P0-T06 | platform-config | |
| P0-T07/T08/T12 | platform-telemetry + hello health | |
| P0-T09 | platform-db | SET LOCAL timeouts for PgBouncer |
| P0-T10 | platform-grpc defaults | |
| P0-T11 | platform-testing | waitFor, withEnv, isDockerAvailable |
| P0-T13 | Compose core | Postgres/PgBouncer/Redis |
| P0-T15 | Dockerfile hello-service | `pnpm docker:build:hello` |
| — | Workflow + progress memory | WORKFLOW.md, PROGRESS.md, AGENTS.md |

---

## Technical decisions learned while building

1. **PgBouncer rejects** startup `options` for `statement_timeout` — use **`SET LOCAL` in transactions**.
2. Pool max hard-capped at **10**.
3. Health: live = process-only; ready = deps, 5s cache.
4. **Docker images:** copy of monorepo dist without `pnpm deploy` misses transitive deps (e.g. `zod`). Use **`pnpm --filter @social/hello-service deploy --prod /out`**.
5. Always-approve permissions for agent; no backdated commits.
6. Config fail-fast at boot via platform-config.

---

## Packages

```
apps/hello-service
libs/platform-config
libs/platform-telemetry
libs/platform-db
libs/platform-grpc
libs/platform-testing
```

---

## How to resume

```bash
pnpm install && pnpm compose:up
pnpm test && pnpm test:integration
pnpm docker:build:hello
# optional smoke: run social-hello:local on Compose network with .env vars
```

Next board items: **P0-T14**, **P0-T16**, **P0-T04**.

---

## Session log

### 2026-07-31
- Established monorepo, CI, Compose core, platform libs, hello-service, workflow memory.
- **P0-T11:** `@social/platform-testing` (waitFor, withEnv, Docker probe) — 10 unit tests.
- **P0-T15:** Distroless Dockerfile with `pnpm deploy`; smoke test: `/health/ready` → postgres up.
