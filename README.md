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

| Area          | Capabilities                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Auth, profiles, visibility, deactivate/erasure, counters, **abuse reports**                                                  |
| Posts         | Create/list/delete, replies/threads, reposts/quotes, mentions/hashtags, likes, **viewerLiked/viewerReposted**, cursor feeds  |
| Graph         | Follow/unfollow + **churn guards**, follow requests, blocks, mutes, cursor lists, cascade on erase                           |
| Timeline      | Fan-out, rebuild via **recent-ids batch**, large-account pull, block/mute filter, cursor home                                |
| Notifications | Aggregation, Redis stream pointers, block/mute suppress, **cursor list**                                                     |
| Realtime      | Tickets, SSE + WebSocket, session revoke / max age, Prometheus `/metrics`                                                    |
| Observability | HTTP RED; **X-Request-Id** in logs; **OTLP traces** to Jaeger when collector is up                                           |
| Search        | ES post/user index; **public-only post filter**; private authors purged on visibility flip                                   |
| Edge          | API gateway (JWT, email_verified, trusted XFF, httpOnly `rt`, Idempotency-Key, RFC 9457, **write velocity limits**, OpenAPI) |

### Explicit non-goals (v2 design)

Media pipeline, DMs, ML ranking, multi-region active-active, ads, automated moderation AI.

### Tests

| Suite                           | Where                                      | Command                                       |
| ------------------------------- | ------------------------------------------ | --------------------------------------------- |
| **Unit (main)**                 | GitHub Actions CI + local                  | `pnpm test`                                   |
| Lint / typecheck / build        | GitHub Actions CI                          | `pnpm lint` · `pnpm typecheck` · `pnpm build` |
| Integration (DB/Redis/ES/Kafka) | **Local only** (or Actions → Run workflow) | `pnpm compose:up && pnpm test:integration`    |
| Full stack smoke                | Manual Actions / local                     | `pnpm compose:stack && pnpm smoke:e2e`        |
| Deploy config check             | Local                                      | `pnpm deploy:check`                           |

### Data export & reports

```http
GET  /v1/users/me/export     # profile + recent posts + following/followers (sync JSON)
POST /v1/reports             # { "targetType": "user"|"post", "targetId": "…", "reason": "spam", "details": "…" }
```

Reports are rate-limited and deduped (one open report per target / 24h).

### Known gaps (not done yet)

Replace example hosts in prod overlays with real domains; pin image digests via `pnpm k8s:pin-digests` when publishing. Full auto-instrumentation (DB/Kafka) optional later. Async export job + signed download URL (design job path) not built — current export is synchronous JSON.

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

### Errors, CORS, OpenAPI, limits

- Errors: `Content-Type: application/problem+json` (RFC 9457) with `type`, `title`, `status`, `detail`, `instance`, `traceId` (from `X-Request-Id`).
- CORS: set `CORS_ORIGINS=…` (comma list). Dev allows all if unset; production requires explicit list. K8s ConfigMaps include defaults per overlay.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS in production.
- Body limit: `JSON_BODY_LIMIT` (default **100kb**).
- Upstream budget: `UPSTREAM_TIMEOUT_MS` (default **5000** → 504 on timeout).
- Spec: `GET /v1/openapi.json`. Version: `GET /v1/version` (`APP_VERSION` / `GIT_COMMIT`).
- Logout everywhere: `POST /v1/auth/logout-all` (Bearer) revokes all sessions + clears `rt` cookie.
- Write velocity (per user): create post **30/h**, like **500/h**, follow **100/day** (env-tunable).

### Viewer state on posts

Authenticated reads attach:

```json
{ "post": { "id": "…", "viewerLiked": true, "viewerReposted": false, … } }
```

Also: `GET /v1/posts/viewer-states?ids=id1,id2` → `{ "states": { "<id>": { "liked", "reposted" } } }`.
Home timeline hydration passes `viewerId` into post batch so feed cards get the same flags.

### Metrics (RED)

Every HTTP service exposes `GET /metrics` (Prometheus text):

| Metric                                                     | RED                |
| ---------------------------------------------------------- | ------------------ |
| `http_requests_total{method,route,status_class}`           | Rate               |
| `http_request_errors_total{method,route}`                  | Errors (5xx)       |
| `http_request_duration_seconds{method,route,status_class}` | Duration histogram |

Routes are cardinality-limited (UUIDs → `:id`). Health and `/metrics` itself are not counted.

### Auth cookies & rate limits (browser)

```http
POST /v1/auth/login     → Set-Cookie: rt=<refresh>; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth
POST /v1/auth/refresh   → cookie `rt` and/or body { "refreshToken" }; rotates cookie
POST /v1/auth/logout    → clears `rt`
```

- **Trusted client IP:** set `TRUSTED_PROXIES` (CIDRs/IPs of ingress/SSR). Only then is `X-Forwarded-For` used for rate-limit keys. Blind spoofing from the public internet is ignored.
- **Anonymous limit:** 100 req/hour/IP (`ANON_RATE_LIMIT`) on unauthenticated traffic; Bearer requests skip this bucket.
- **mention-repair** uses a Postgres advisory lock so only one replica runs each cycle.

### Idempotency (create post)

```http
POST /v1/posts
Authorization: Bearer …
Idempotency-Key: <client-generated unique key>
```

Retries with the same key + body return the original response (`Idempotent-Replay: true`). Same key + different body → `422`. Concurrent in-flight → `409`. Server 5xx drops the key so a genuine retry can proceed. Stored in Redis (24h). Set `IDEMPOTENCY_OPTIONAL=1` only for local break-glass.

### Request correlation, tracing & pagination

```http
X-Request-Id: <echoed or generated>
traceparent: 00-<traceid>-<spanid>-<flags>   # accepted, spanned, and forwarded
```

- Gateway/services propagate `X-Request-Id` + W3C `traceparent` upstream.
- Logs include `requestId` from ALS when a request is in flight.
- When `OTEL_EXPORTER_OTLP_ENDPOINT` is set (Compose: `http://otel-collector:4318` or host `http://127.0.0.1:4318`), each HTTP request exports a SERVER span to the collector → **Jaeger** (`http://127.0.0.1:16686`). Disable with `OTEL_SDK_DISABLED=1`.

### Duplicate post guard

Identical non-empty top-level content from the same author within **24h** returns **409** with `type` `…/problems/duplicate-content` (`POST_DUPLICATE_WINDOW_HOURS`, disable with `POST_DUPLICATE_DETECT=0`).

### Follow churn

- Re-follow the same user within **60m** of unfollow → **429** `…/problems/follow-churn`
- More than **40** follows / requests in **15m** → **429** (burst)
- Tunable: `FOLLOW_CHURN_PAIR_MINUTES`, `FOLLOW_CHURN_BURST_*`; off with `FOLLOW_CHURN_DETECT=0`

### Timeline rebuild primitive

```http
GET /v1/posts/recent-ids?authorIds=u1,u2&perAuthor=20&limit=400
→ { "ids": ["…"] }
```

Uses a per-author lateral scan (≤20 each) so rebuilds stay O(authors × perAuthor).

```http
GET /v1/posts?authorId=…&limit=20&cursor=…
GET /v1/graph/followers/:userId?limit=50&cursor=…
GET /v1/timelines/home?limit=20&cursor=…          # also accepts legacy ?before=<postId>
GET /v1/notifications?limit=30&cursor=…
→ { …, "page": { "next_cursor": "…"|null, "has_more": true|false } }
```

Realtime tickets: **20/min per user** (`TICKET_RATE_LIMIT` / `TICKET_RATE_WINDOW_SEC`).

### Email verification (write path)

Access tokens carry `email_verified`. In production (or when `ENFORCE_EMAIL_VERIFIED=1`), gateway write routes (post/like/follow/block/mute) return:

```json
{
  "type": "https://api.social.example.com/problems/email-not-verified",
  "title": "Email not verified",
  "status": 403,
  "detail": "Verify your email before performing this action."
}
```

Local/smoke leaves enforcement off so register → post still works. After verify-email, clients must **refresh** to pick up `email_verified=true` in a new access token.

### Prod deploy helpers

```bash
pnpm k8s:secrets:eso          # ExternalSecrets Operator manifests
REGISTRY=ghcr.io/org TAG=1.0.0 pnpm k8s:pin-digests   # print/write image digests
pnpm k8s:apply:prod
```

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
