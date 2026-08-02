# Distributed Social Media Backend

A NestJS microservices backend for a public microblogging product: accounts, posts, likes, an asymmetric follow graph (including **private accounts / follow requests**), home timelines, real-time notifications, and search.

Inspired by feed systems like X (Twitter) and LinkedIn — **distributed services and event-driven infrastructure**, not a decentralized or federated network.

|                  |                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | **Backend MVP in progress** — core services, events, realtime, Docker/CI, and k8s scaffolding landed. Product gaps remain (see below). |
| **Stack**        | NestJS · TypeScript · gRPC · Kafka · PostgreSQL · Redis · Elasticsearch · Kubernetes                                                   |
| **Design point** | 1M users · 200K DAU · ~700 RPS peak · sized for 1,500 RPS                                                                              |

---

## What this is

Nine apps (HTTP gateway, realtime gateway, six domain services, plus `hello-service` smoke). Each domain service owns its schema. Async work uses **Kafka** via a **transactional outbox**; consumers use dedupe + retry/DLQ. Timelines are derived Redis state and rebuildable.

### Implemented surface

| Area          | Capabilities                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Identity      | Register/login/refresh, JWT + JWKS, profiles, visibility (`public` / `followers`), deactivate → erasure worker, follow/post counters |
| Posts         | Create/list/delete, replies/threads, reposts/quotes, **@mentions + #hashtags**, likes, private-author read authz                     |
| Graph         | Follow/unfollow, **follow requests** (private accounts), blocks, mutes, cascade jobs on erase                                        |
| Timeline      | Fan-out on write, follow backfill, large-account pull, block/mute filter at hydration                                                |
| Notifications | Follow/like/follow_request aggregation, Redis stream pointers, block/mute suppress                                                   |
| Realtime      | Tickets, SSE + WebSocket, session revoke / max age, Prometheus `/metrics`                                                            |
| Observability | **HTTP RED** (`http_requests_total`, `http_request_duration_seconds`, `http_request_errors_total`) on all HTTP apps                  |
| Search        | ES post/user index; **public-only post filter**; private authors purged on visibility flip                                           |
| Edge          | API gateway (JWT, rate limit, sid revocation), route inventory, smoke e2e                                                            |

### Explicit non-goals (v2 design)

Media pipeline, DMs, ML ranking, multi-region active-active, ads, automated moderation AI.

### Known gaps (not done yet)

Production secret store / image digests wired for real clusters; mention-repair depends on identity being up (no multi-tenant job leader yet).

---

## Architecture (summary)

```
Clients (Web / Mobile)
        │
        ▼
┌───────────────┐     ┌──────────────────┐
│  API Gateway  │     │ Realtime Gateway │
│  REST :3000   │     │  SSE/WS :3007    │
└───────┬───────┘     └────────┬─────────┘
        │                      │
        ▼                      ▼
 Identity · Post · Graph · Timeline · Notification · Search
        │                      │
        ▼                      ▼
 Kafka (outbox events)    Postgres · Redis · Elasticsearch
```

Full design: [`docs/01-architecture/system-design.md`](docs/01-architecture/system-design.md)

---

## Prerequisites

- **Node.js** 22+ (see [`.nvmrc`](.nvmrc))
- **pnpm** 9 (`packageManager` in `package.json`)
- **Docker** (Compose for infra; optional app images)

```bash
nvm use   # optional
```

---

## Quick start

### 1. Infra + deps

```bash
pnpm install
cp .env.example .env
pnpm compose:up          # Postgres, PgBouncer, Redis, Redpanda, ES, Jaeger, OTel
pnpm compose:check       # optional health script
```

### 2. Run services (local processes)

```bash
pnpm dev:identity        # :3001 (+ gRPC :50051)
pnpm dev:gateway         # :3000
pnpm dev:post            # :3002
pnpm dev:graph           # :3003
pnpm dev:timeline        # :3004
pnpm dev:notification    # :3005
pnpm dev:search          # :3006
pnpm dev:realtime        # :3007
```

Or Docker apps on top of infra:

```bash
pnpm compose:stack       # infra + build/start all app images
pnpm smoke:e2e           # gateway register → post → follow → like → deactivate
```

### 3. Useful commands

```bash
pnpm build
pnpm test
pnpm test:integration    # needs compose:up
pnpm routes:list
pnpm openapi:export -- --out=/tmp/openapi.json
pnpm dlq:list -- --topic social.post.v1
```

| Port         | Service               |
| ------------ | --------------------- |
| 3000         | api-gateway           |
| 3001 / 50051 | identity HTTP / gRPC  |
| 3002         | post                  |
| 3003         | graph                 |
| 3004         | timeline              |
| 3005         | notification          |
| 3006         | search                |
| 3007         | realtime              |
| 6432         | PgBouncer             |
| 6379         | Redis                 |
| 19092        | Kafka (Redpanda host) |
| 9200         | Elasticsearch         |
| 16686        | Jaeger UI             |

---

## Private accounts & follow requests

Identity profile `visibility`:

- `public` — follow creates an edge immediately (`user.followed`)
- `followers` — follow creates a **request** (`follow.requested` → notification type `follow_request`)

```http
POST /v1/graph/follows/:userId          → { "state": "following"|"requested", "changed": true }
GET  /v1/graph/follow-requests/incoming
POST /v1/graph/follow-requests/:requesterId/accept
POST /v1/graph/follow-requests/:requesterId/reject
PATCH /v1/users/me  { "visibility": "followers" }
```

Accept emits `user.followed` in the same transaction. Reject is silent. Blocks clear follows **and** pending requests both ways.

---

## Replies & reposts

```http
POST /v1/posts  { "content": "hello" }
POST /v1/posts  { "content": "reply", "replyToId": "<postId>" }
POST /v1/posts  { "repostOfId": "<postId>" }                    # pure repost
POST /v1/posts  { "content": "quote", "repostOfId": "<postId>" } # quote
GET  /v1/posts/:id/replies
GET  /v1/posts/:id/thread
```

- Replies set `threadRootId` (denormalised); emit `post.replied` (notification type `reply`). They do **not** fan out to home timelines.
- Pure/quote reposts emit `post.created` (timeline + search) and `post.reposted` (notification type `repost`).
- Repost-of-repost collapses to the original content post. One pure repost per author per original (`409` if duplicated).

### Mentions, hashtags, private content

- `@username` (max 10) resolved via identity (300ms, failure → store unresolved). Emits `user.mentioned` → notif `mention`. **mention-repair** retries unresolved rows every 15 min.
- `#hashtag` (max 10) stored normalised; search indexes hashtags from content.
- Post length: **≤280 grapheme clusters** (API); DB allows multi-codepoint emoji within a byte budget.
- Authors with `visibility=followers`: anonymous `GET` post/profile feed returns **404**; followers (JWT) may read. Search never indexes their posts (`author_visibility=public` filter + skip on index).

### Metrics (RED)

Every HTTP service exposes `GET /metrics` (Prometheus text):

| Metric                                                     | RED                |
| ---------------------------------------------------------- | ------------------ |
| `http_requests_total{method,route,status_class}`           | Rate               |
| `http_request_errors_total{method,route}`                  | Errors (5xx)       |
| `http_request_duration_seconds{method,route,status_class}` | Duration histogram |

Routes are cardinality-limited (UUIDs → `:id`). Health and `/metrics` itself are not counted.

---

## Project layout

```
apps/
  api-gateway/  identity-service/  post-service/  graph-service/
  timeline-service/  notification-service/  search-service/
  realtime-gateway/  hello-service/
libs/
  platform-config/  platform-db/  platform-events/  platform-redis/
  platform-telemetry/  platform-grpc/  platform-testing/
docker/           # infra + app Compose + Dockerfiles
deploy/k8s/       # manifests, overlays, ESO, monitoring
deploy/argocd/    # GitOps Applications
scripts/          # smoke-e2e, routes, openapi, dlq-inspect, docker-build
docs/             # architecture & component design (contract)
```

---

## Deploy notes

| Path                  | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `pnpm compose:stack`  | Full local Docker stack                   |
| `pnpm k8s:apply:dev`  | Kustomize dev overlay                     |
| `pnpm k8s:apply:prod` | Prod overlay (registry + ExternalSecrets) |
| `pnpm argocd:apply`   | Argo CD Applications                      |

See [`deploy/k8s/README.md`](deploy/k8s/README.md).

---

## CI

| Workflow    | What                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| `ci.yml`    | lint, typecheck, unit tests, build, Docker image matrix, **infra + integration tests** |
| `smoke.yml` | nightly/manual full stack + `smoke:e2e`                                                |

---

## Documentation

| Path                                                                                     | Contents             |
| ---------------------------------------------------------------------------------------- | -------------------- |
| [`docs/README.md`](docs/README.md)                                                       | Doc index            |
| [`docs/01-architecture/`](docs/01-architecture/)                                         | System design + ADRs |
| [`docs/02-components/`](docs/02-components/)                                             | Per-service specs    |
| [`docs/05-roadmap/implementation-roadmap.md`](docs/05-roadmap/implementation-roadmap.md) | Phased plan          |

Treat **`docs/`** as the behavioral contract where code has not yet overridden it.

---

## License

Private / unlicensed (`UNLICENSED` in `package.json`) unless stated otherwise.
