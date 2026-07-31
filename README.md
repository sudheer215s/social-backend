# Distributed Social Media Backend

A NestJS microservices backend for a public microblogging product: accounts, posts, replies, reposts, likes, an asymmetric follow graph, home timelines, real-time notifications, and search.

Inspired by feed systems like X (Twitter) and LinkedIn — **distributed services and event-driven infrastructure**, not a decentralized or federated network.

|                  |                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------ |
| **Status**       | Design complete (v2). Implementation starting at Phase 0.                            |
| **Stack**        | NestJS · TypeScript · gRPC · Kafka · PostgreSQL · Redis · Elasticsearch · Kubernetes |
| **Design point** | 1M users · 200K DAU · ~700 RPS peak · sized for 1,500 RPS                            |

---

## What this is

Eight deployables: two gateways (HTTP, WebSocket) and six domain services. Each service owns its data. Request/response uses **gRPC**; propagation uses **Kafka** (transactional outbox, effectively-once consumers). Timelines are derived state in Redis and can be rebuilt from durable sources.

### Product surface

| Area          | Capabilities                                                              |
| ------------- | ------------------------------------------------------------------------- |
| Identity      | Registration, login, JWT + rotating refresh, profiles, email verification |
| Posts         | Create/delete, likes, replies, reposts, hashtags, mentions                |
| Graph         | Follow/unfollow, blocks, mutes, private accounts                          |
| Timeline      | Home + user timelines (hybrid fan-out, rebuild-safe)                      |
| Notifications | In-app alerts with real-time delivery                                     |
| Search        | Users, posts, trending                                                    |

### Explicit non-goals (v2)

Media processing pipeline, direct messaging, ML ranking, multi-region active-active, ads, and automated moderation AI. Seams are left in the design where those can attach later.

---

## Architecture (summary)

```
Clients (Web / Mobile)
        │
        ▼
┌───────────────┐     ┌──────────────────┐
│  API Gateway  │     │ Realtime Gateway │
│  (REST/HTTP)  │     │   (WebSocket)    │
└───────┬───────┘     └────────┬─────────┘
        │ gRPC                 │
        ▼                      ▼
┌──────────── Identity · Post · Graph · Timeline · Notification · Search ────────────┐
│                              (domain services)                                     │
└────────────┬───────────────────────────────────────────────┬───────────────────────┘
             │                                               │
             ▼                                               ▼
      Kafka (events)                                   PostgreSQL (per service)
      Redis (timelines, cache, rate limits)            Elasticsearch (search)
```

**Load-bearing ideas:** UUIDv7 IDs, transactional outbox, effectively-once consumers, disposable rebuildable timelines, filter-at-hydration (never “delete from N timelines”), blocks fail closed.

Full design: [`docs/01-architecture/system-design.md`](docs/01-architecture/system-design.md)

---

## Documentation

Start here: **[`docs/README.md`](docs/README.md)**  
Implementation roadmap: **[`docs/05-roadmap/implementation-roadmap.md`](docs/05-roadmap/implementation-roadmap.md)**

| Path                                                                                     | Contents                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`docs/01-architecture/`](docs/01-architecture/)                                         | System design + ADRs                                   |
| [`docs/02-components/`](docs/02-components/)                                             | Per-service specs                                      |
| [`docs/03-cross-cutting/`](docs/03-cross-cutting/)                                       | API, security, data, SLOs, reliability, CI/CD, testing |
| [`docs/05-roadmap/implementation-roadmap.md`](docs/05-roadmap/implementation-roadmap.md) | 9 phases · 22 weeks · exit criteria                    |
| [`docs/00-review/`](docs/00-review/) · [`docs/04-review/`](docs/04-review/)              | Design reviews (v1 → v2)                               |

Historical v1 planning docs remain in the repo root for reference and are superseded by `docs/`.

---

## Implementation roadmap

| Phase | Focus                                                         |
| ----: | ------------------------------------------------------------- |
|     0 | Platform: monorepo, CI/CD, observability, local Compose stack |
|     1 | Identity + API gateway (auth, tokens, profiles)               |
|     2 | Posts + social graph + authorization matrix                   |
|     3 | Event backbone (outbox, consumers, DLQ)                       |
|     4 | Timeline fan-out and read path                                |
|     5 | Notifications + realtime gateway                              |
|     6 | Search + trending                                             |
|     7 | Hardening (abuse, erasure, DR)                                |
|     8 | Scale validation and launch readiness                         |

Details and gates: [`docs/05-roadmap/implementation-roadmap.md`](docs/05-roadmap/implementation-roadmap.md)

---

## Repository status

| Item                      | State                                                          |
| ------------------------- | -------------------------------------------------------------- |
| Architecture (v2)         | Documented and review-approved                                 |
| Application code          | Monorepo: hello-service + platform-config/telemetry/db/grpc    |
| Local multi-service stack | Compose: Postgres, PgBouncer, Redis, Redpanda, ES, Jaeger, OTel |
| Production deploy         | Not yet                                                        |

This is a deliberate **design-first** repo: the hard distributed-systems choices (timeline algorithm, capacity model, consistency, authz) are specified before service code lands.

---

## Prerequisites

- **Node.js** 22+ (see [`.nvmrc`](.nvmrc))
- **pnpm** 9 (`packageManager` in `package.json`)

```bash
# optional: match Node version
nvm use
```

---

## Quick start

**Clean clone (P0-T16):** one script installs deps, starts Compose, builds, and tests.

```bash
bash scripts/dev-setup.sh   # or: pnpm dev:setup
pnpm dev                    # hello-service (watch)
pnpm dev:identity           # identity-service on :3001
pnpm dev:gateway            # api-gateway on :3000
pnpm dev:post               # post-service on :3002
pnpm dev:graph              # graph-service on :3003
pnpm dev:timeline           # timeline-service on :3004
```

**Manual:**

```bash
pnpm install
cp .env.example .env
pnpm compose:up             # Postgres, PgBouncer, Redis, Redpanda, ES, Jaeger, OTel
pnpm docker:build:hello     # optional image
pnpm dev
# GET /  GET /health/live  GET /health/ready
# Jaeger UI: http://127.0.0.1:16686  ·  ES: http://127.0.0.1:9200
```

Other scripts (Turbo, all packages):

```bash
pnpm build            # compile all packages
pnpm test             # unit tests
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm --filter @social/hello-service test:e2e
pnpm --filter @social/platform-db test:integration  # needs compose:up
```

`hello-service` listens on `PORT` (default 3000).

---

## Project layout

```
social-backend/
├── apps/
│   ├── hello-service/             # Phase 0 smoke service (Nest)
│   ├── identity-service/          # Phase 1 auth (register/login/tokens/email)
│   ├── api-gateway/               # Public edge: JWT verify + auth proxy
│   ├── post-service/              # Phase 2 posts + likes
│   ├── graph-service/             # Phase 2 follows + blocks
│   └── timeline-service/          # Phase 3/4 home timeline + fan-out
├── libs/
│   ├── platform-config/           # fail-fast Zod config
│   ├── platform-telemetry/        # Pino logger, redaction, health probes
│   ├── platform-db/               # pg pool, Drizzle, transactions
│   ├── platform-grpc/             # client policy defaults (retry budget)
│   └── platform-testing/          # waitFor, withEnv, Docker helpers
├── docker/                        # Compose + Dockerfile.hello-service
├── .github/workflows/ci.yml       # lint · typecheck · test · build · e2e
├── docs/                          # Architecture & roadmap (source of truth)
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── README.md
```

Historical v1 docs remain in the repo root (superseded by `docs/`).
---

## Tech choices

| Concern           | Choice                  | Why                                                                |
| ----------------- | ----------------------- | ------------------------------------------------------------------ |
| Framework         | NestJS + TypeScript     | Modular services, strong typing, first-class microservices support |
| Sync RPC          | gRPC                    | Low latency, typed contracts                                       |
| Async events      | Kafka (local: Redpanda) | Throughput, partitioning, durable log                              |
| Primary store     | PostgreSQL              | ACID, complex queries; logical DB-per-service                      |
| Cache / timelines | Redis                   | Sorted sets, low-latency reads, rebuildable state                  |
| Search            | Elasticsearch           | Full-text + analytics                                              |
| Orchestration     | Kubernetes              | Scale, deploy, resilience                                          |

Decision records: [`docs/01-architecture/decisions.md`](docs/01-architecture/decisions.md)

---

## Contributing / development notes

1. Treat **`docs/`** as the contract for behavior until code supersedes a section.
2. Prefer small, reviewable commits aligned with roadmap phases.
3. Do not invent cross-service joins; respect service ownership and event contracts.
4. Observability, tests, and security controls ship **with** features (see roadmap definition of done).

---

## License

Private / unlicensed (`UNLICENSED` in `package.json`) unless stated otherwise.
