# Implementation Task Board

**Process (every task):** `task → test → code & build → test → review → commit → update PROGRESS.md` (see WORKFLOW.md / PROGRESS.md)
**Dates:** real commit timestamps only (no backdating).
**Source of truth:** [`implementation-roadmap.md`](./implementation-roadmap.md) + `docs/01–03`.

Status: `todo` | `doing` | `done` | `blocked`

---

## Phase 0 — Platform foundation

### Slice A — Repo & toolchain

| ID         | Task                                        | Verifiable output                                                                      | Tests                                               | Status |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| **P0-T01** | Strict TypeScript baseline green            | `pnpm typecheck` + `pnpm test` pass with `strict` + `noUncheckedIndexedAccess`         | Existing unit test green; bootstrap handles promise | `done` |
| **P0-T02** | pnpm workspace monorepo (`apps/` + `libs/`) | `pnpm install`; hello app builds from `apps/hello-service`; workspace packages resolve | Build + unit tests from monorepo layout             | `done` |
| **P0-T03** | Root tooling: Turbo, scripts, path aliases  | `pnpm turbo typecheck test lint` runs all packages                                     | CI-local script smoke                               | `done` |
| **P0-T04** | ESLint boundaries + Prettier + Husky        | Lint fails on illegal cross-app imports; pre-commit runs lint-staged                   | Fixture / lint smoke                                | `todo` |
| **P0-T05** | GitHub Actions CI (static + unit)           | Workflow on PR/main: install, lint, typecheck, test                                    | Workflow present; local equivalent scripts          | `done` |

### Slice B — Platform libraries (core)

| ID         | Task                                      | Verifiable output                                                                                 | Tests                                    | Status |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| **P0-T06** | `platform-config`                         | `loadConfig()` validates env with Zod; fail-fast on missing required; redacts secrets in `toJSON` | Unit: valid/invalid/redaction/pool cap   | `done` |
| **P0-T07** | `platform-telemetry` (logger + redaction) | Pino JSON logger; redacts password/token/email/authorization                                      | Unit: redaction cases                    | `done` |
| **P0-T08** | `platform-telemetry` (health)             | `/health/live` (process only) vs `/health/ready` (deps, cached 5s)                                | Unit/integration for live vs ready split | `done` |
| **P0-T09** | `platform-db` skeleton                    | Drizzle client factory; pool max ≤ 10; timeouts documented                                        | Unit: config wiring                      | `done` |
| **P0-T10** | `platform-grpc` skeleton                  | Client factory defaults: deadline, retry budget, breaker                                          | Unit: option defaults                    | `done` |
| **P0-T11** | `platform-testing` skeleton               | Shared Jest helpers; Testcontainers helper (when Docker available)                                | Unit for helpers                         | `done` |

### Slice C — Hello service + local stack

| ID         | Task                                               | Verifiable output                                       | Tests                   | Status |
| ---------- | -------------------------------------------------- | ------------------------------------------------------- | ----------------------- | ------ |
| **P0-T12** | `hello-service` uses config + telemetry + health   | App boots only with valid env; live/ready + hello route | e2e: health endpoints   | `done` |
| **P0-T13** | Docker Compose core (Postgres + PgBouncer + Redis) | `docker compose up` healthy                             | Compose healthchecks    | `done` |
| **P0-T14** | Compose extended (Redpanda + ES + OTel)            | Full local stack starts                                 | Healthchecks green      | `done` |
| **P0-T15** | Multi-stage Dockerfile for apps                    | Image builds for `hello-service`                        | `docker build` succeeds | `done` |
| **P0-T16** | `pnpm dev` clean-clone path                        | Documented & scripted                                   | Checklist in README     | `done` |

### Phase 0 exit criteria (from roadmap)

| Gate                                     | Maps to                       | Status                 |
| ---------------------------------------- | ----------------------------- | ---------------------- |
| Trivial service deploys through pipeline | P0-T05, T12, T15 (+ CD later) | partial                |
| Trace crosses process boundary           | P0-T07–T08, T12, OTel         | todo                   |
| Metrics + one alert                      | later observability           | todo                   |
| Preview env PR lifecycle                 | CD / Argo                     | todo                   |
| `pnpm dev` &lt; 10 min                   | P0-T16                        | done                   |
| Canary abort                             | CD / Argo Rollouts            | deferred until cluster |

---

## Phase 1 — Identity + API gateway (after P0)

| ID         | Task                                          | Verifiable output                                         | Status |
| ---------- | --------------------------------------------- | --------------------------------------------------------- | ------ |
| **P1-T01** | Identity schema + migrations                  | users, credentials, sessions, user_settings, email_tokens | `done` |
| **P1-T02** | Register + login (argon2id, anti-enumeration) | Timing-safe failures                                      | `done` |
| **P1-T03** | EdDSA access tokens + JWKS rotation           | Verify with rotated keys                                  | `todo` |
| **P1-T04** | Refresh rotation + reuse detection            | Reuse revokes family                                      | `todo` |
| **P1-T05** | Email verify + password reset ports           | Provider behind internal interface                        | `todo` |
| **P1-T06** | API gateway JWT + rate limit + RFC 9457       | Contract tests                                            | `todo` |
| **P1-T07** | Profile CRUD + cache                          | Auth e2e journey                                          | `todo` |

---

## Later phases (placeholders)

| Phase | Theme                        | First task when ready             |
| ----- | ---------------------------- | --------------------------------- |
| 2     | Posts + graph + authz matrix | Schema + create post + follow     |
| 3     | Events / outbox / consumers  | `platform-events` outbox + dedupe |
| 4     | Timeline                     | Fan-out Lua + rebuild             |
| 5     | Notifications + realtime     | Aggregation + WS ticket           |
| 6     | Search                       | Index + private filter            |
| 7     | Hardening                    | Erasure + abuse                   |
| 8     | Scale validation             | Load suite                        |

---

## Current focus

**Active:** Phase 0 — P0-T04 (eslint boundaries), then Phase 0 exit polish / Phase 1 prep.
**Completed:** P0-T01–T03, P0-T05–T16 (except P0-T04).

