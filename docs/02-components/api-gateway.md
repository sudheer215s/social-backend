# Component Design — `api-gateway`

**Kind:** HTTP (REST/JSON) · stateless
**Owns:** nothing durable
**Scales on:** request rate
**Depends on:** all six domain services (gRPC), Redis (rate limits, idempotency, JWKS cache)

---

## 1. Responsibility

The single public HTTP surface. It is a **BFF**, not a proxy: it composes responses from multiple services so that clients make one call per screen.

| Does | Does not |
|---|---|
| Terminate the public REST contract | Own any data |
| Verify JWTs against cached JWKS | Issue or sign tokens (ADR-0010) |
| Rate limit and enforce quotas | Make authorization decisions authoritative (defence in depth only) |
| Enforce idempotency on unsafe methods | Talk to Postgres, Kafka, or Elasticsearch |
| Compose/aggregate across services | Hold WebSocket connections (see `realtime-gateway`) |
| Normalise errors, translate gRPC status | Contain business rules |

**Authorization is defence in depth here.** The gateway performs cheap, obvious checks (is this the caller's own resource?), but the data-owning service is authoritative. A gateway bug must not be able to expose data (system design §11.1).

---

## 2. Request pipeline

Order matters; each stage is a Nest middleware/guard/interceptor.

```
1  request-id + W3C traceparent      → generate or propagate; every log line carries both
2  body limits                       → 100 KB JSON, 1 MB multipart; reject early
3  CORS + security headers           → helmet, strict CSP, HSTS
4  authentication                    → Bearer JWT, JWKS cached 5 min, kid-keyed
5  session revocation check          → Redis set lookup on `sid`, only if sid is in the revoked bloom
6  rate limiting                     → §4
7  idempotency                       → §5, unsafe methods only
8  validation                        → class-validator DTO, whitelist + forbidNonWhitelisted
9  handler                           → gRPC calls with propagated deadline
10 serialisation                     → class-transformer, explicit @Expose only
11 error mapping                     → §6
```

Stage 5 is cheap because the common case is a miss: revoked `sid`s go into a small Redis set with a TTL equal to the access-token lifetime (10 min), so it holds only sessions revoked in the last 10 minutes — typically a handful of entries.

### Deadline propagation

The inbound request gets a 5-second budget. Each gRPC call receives `remaining − 100 ms` of processing slack, so a slow upstream cannot make the gateway hold a connection past its own budget:

```ts
const deadline = ctx.deadline ?? Date.now() + 5_000;
const perCall  = Math.max(200, deadline - Date.now() - 100);
```

Fan-out composition (e.g. a post plus its author plus the viewer's like state) issues calls in parallel with a shared budget, not serially.

---

## 3. REST surface

Full conventions — errors, pagination, headers, versioning — are in [`api-conventions.md`](../03-cross-cutting/api-conventions.md). Routes below note which service backs them and whether the gateway composes.

### Auth
| Method | Path | Backing | Notes |
|---|---|---|---|
| POST | `/v1/auth/register` | identity | Rate limited by IP; returns tokens |
| POST | `/v1/auth/login` | identity | IP + account limits; constant-time failure |
| POST | `/v1/auth/refresh` | identity | Rotating; reuse revokes the family |
| POST | `/v1/auth/logout` | identity | Revokes `sid` |
| POST | `/v1/auth/logout-all` | identity | Revokes every session for the user |
| POST | `/v1/auth/verify-email` | identity | Single-use token |
| POST | `/v1/auth/password/forgot` | identity | Always `202`, never reveals existence |
| POST | `/v1/auth/password/reset` | identity | Single-use token; revokes all sessions |

### Users
| Method | Path | Backing | Notes |
|---|---|---|---|
| GET | `/v1/users/me` | identity | |
| PATCH | `/v1/users/me` | identity | |
| DELETE | `/v1/users/me` | identity | Starts staged erasure |
| GET | `/v1/users/me/settings` · PATCH | identity | |
| GET | `/v1/users/{userId}` | identity + graph | Composes `is_following`, `is_followed_by`, `is_blocked` |
| GET | `/v1/users/by-username/{username}` | identity | **Disambiguated route** |
| GET | `/v1/users/{userId}/posts` | post | |
| GET | `/v1/users/{userId}/followers` · `/following` | graph + identity | Composes profile summaries |
| PUT/DELETE | `/v1/users/{userId}/follow` | graph | `PUT` — idempotent by construction |
| PUT/DELETE | `/v1/users/{userId}/block` · `/mute` | graph | |

> **`/v1/users/by-username/{username}` is deliberate.** v1 defined both `GET /users/:username` and `GET /users/:id/followers`, putting two different parameter *types* in the same positional segment — `GET /users/alice` and `GET /users/{uuid}` are indistinguishable to a router, and a user named `me` collides with `/users/me` (review G1). Separating the namespace removes the ambiguity permanently.

### Posts
| Method | Path | Backing | Notes |
|---|---|---|---|
| POST | `/v1/posts` | post | **Requires `Idempotency-Key`** |
| GET | `/v1/posts/{postId}` | post + identity + graph | Composes author, viewer like state, visibility |
| DELETE | `/v1/posts/{postId}` | post | Soft delete; owner or moderator |
| PUT/DELETE | `/v1/posts/{postId}/like` | post | `PUT` — idempotent |
| GET | `/v1/posts/{postId}/likes` | post + identity | |
| GET/POST | `/v1/posts/{postId}/replies` | post | POST requires `Idempotency-Key` |
| POST | `/v1/posts/{postId}/repost` | post | Requires `Idempotency-Key` |

`PUT`/`DELETE` for like and follow rather than `POST`/`DELETE` is a deliberate choice: these are **state assertions**, not actions, so they are idempotent by HTTP semantics and need no idempotency key. A retried `PUT .../like` is definitionally safe.

### Timelines, notifications, search
| Method | Path | Backing |
|---|---|---|
| GET | `/v1/timelines/home` | timeline (hydrates via post + identity) |
| GET | `/v1/timelines/user/{userId}` | post |
| GET | `/v1/notifications` · `/unread-count` | notification + identity |
| POST | `/v1/notifications/read` | notification |
| GET | `/v1/search/posts` · `/users` · `/hashtags` | search (hydrates via post + identity) |
| GET | `/v1/trending/hashtags` | search |
| POST | `/v1/realtime/ticket` | identity — short-lived WS ticket (see `realtime-gateway`) |

### Operational
`GET /health/live` (process only), `GET /health/ready` (dependency probe), `GET /metrics` (Prometheus, cluster-internal), `GET /v1/openapi.json`.

Liveness must **not** check dependencies. Wiring liveness to a Redis check means one Redis blip restarts the entire fleet simultaneously (review H7).

---

## 4. Rate limiting

Sliding-window counters in Redis via a single atomic Lua script (`GET`/`INCR`/`EXPIRE` as three round trips races under concurrency).

| Scope | Limit | Window | Key | Rationale |
|---|---|---|---|---|
| `auth:login` | 5 | 1 min | IP | Credential stuffing |
| `auth:login:account` | 10 | 15 min | account | Targeted attack on one account |
| `auth:register` | 3 | 1 h | IP | Bulk signup |
| `auth:password-reset` | 3 | 1 h | IP + account | Reset spam |
| `post:create` | 30 | 1 h | user | Spam |
| `post:like` | 500 | 1 h | user | Bot behaviour |
| `graph:follow` | 100 | 1 d | user | Follow-churn abuse |
| `search` | 30 | 1 min | user | Cost control |
| `read:general` | 1,000 | 1 h | user | Backstop |
| `anon` | 100 | 1 h | IP | Scraping |

Two independent limits on login (per-IP and per-account) is the point: per-IP alone misses a distributed attack on one account; per-account alone misses one host spraying many accounts.

All responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. `429` adds `Retry-After`. Limits are config, reloadable without deploy.

**Failure mode: fail open.** If Redis is unavailable, requests pass and `rate_limit_failopen_total` increments and alerts. A rate limiter that takes the site down is worse than the abuse it prevents — but this must be visible, not silent.

---

## 5. Idempotency

v1 specified an idempotency table in §14.5 and then required it on no endpoint, so a retried `POST /posts` created duplicate posts (review F5).

Required on `POST /v1/posts`, `/replies`, `/repost`. Optional and honoured elsewhere.

```
key   = sha256(user_id ‖ method ‖ path ‖ Idempotency-Key)
redis = idem:{key}   TTL 24 h

1. SET idem:{key} '{"state":"in_flight"}' NX EX 60
2. NX succeeded  → execute; on success store {state:completed, status, body} EX 24h
                 → on 4xx store the response too (a bad request is deterministic)
                 → on 5xx DEL the key (allow a genuine retry)
3. NX failed, state=in_flight   → 409 with Retry-After: 1
4. NX failed, state=completed   → replay stored response + `Idempotent-Replay: true`
5. NX failed, different request hash → 422 (key reuse with a different body)
```

The `in_flight` marker is what makes concurrent duplicates safe — two simultaneous retries do not both execute. Case 2's 5xx branch matters: a server error is not a deterministic outcome, so the key must not pin it.

---

## 6. Errors

RFC 9457 `application/problem+json`, one shape everywhere:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "content must be 1–280 characters",
  "instance": "/v1/posts",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [{ "field": "content", "code": "max_length", "message": "..." }]
}
```

`traceId` on every error is what makes support tractable: a user-reported failure becomes a trace lookup.

### gRPC → HTTP mapping

| gRPC | HTTP | Retryable |
|---|---|---|
| `OK` | 200/201/204 | — |
| `INVALID_ARGUMENT` | 400 | no |
| `UNAUTHENTICATED` | 401 | no |
| `PERMISSION_DENIED` | 403 | no |
| `NOT_FOUND` | 404 | no |
| `ALREADY_EXISTS` | 409 | no |
| `FAILED_PRECONDITION` | 422 | no |
| `RESOURCE_EXHAUSTED` | 429 | yes, after `Retry-After` |
| `UNAVAILABLE` | 503 | yes |
| `DEADLINE_EXCEEDED` | 504 | yes |
| `INTERNAL` / `UNKNOWN` | 500 | no |

Internal messages are never forwarded. `500` bodies carry a generic `detail` plus the trace ID; the real message goes to logs only.

---

## 7. gRPC client policy

One shared factory (`libs/platform-grpc`) so policy is uniform and cannot drift per-service.

```ts
{
  deadline: propagated,                 // never a fixed timeout
  retry: {                              // idempotent methods only
    max: 2, backoff: 'exponential', base: 50, jitter: 'full',
    on: ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED'],
    budget: 0.1,                        // ≤10% of requests may be retries
  },
  breaker: { volumeThreshold: 20, errorThreshold: 0.5, halfOpenAfter: 15_000, halfOpenMax: 3 },
  loadBalancing: 'round_robin',         // over headless service DNS
  keepalive: { time: 30_000, timeout: 10_000 },
}
```

Three details that matter more than the numbers:

- **Retry budget.** Without a cap, retries amplify a partial outage into a full one — every client retrying triples load on an already-struggling service. 10% is a hard ceiling.
- **Full jitter**, not fixed backoff, to avoid synchronised retry waves.
- **Retries only on idempotent methods**, marked in the proto via a method option and enforced by the factory rather than left to callers.

---

## 8. Composition

The gateway's value is avoiding client-side N+1. Timeline hydration is the canonical example:

```
GET /v1/timelines/home
  → timeline.GetHomeTimeline()                  # returns hydrated posts + author ids
  → identity.GetUsersByIds(unique author ids)   # 1 call, ≤100
  → post.GetViewerStates(viewer, post ids)      # liked/reposted, 1 call
  ⇒ assembled response
```

Three gRPC calls for a 20-post page, regardless of page size. Rules: batch RPCs only (never per-item), all independent calls in parallel, batches capped at 100, and a partial failure degrades a *field* (author renders as a placeholder) rather than the response.

---

## 9. Failure modes

| Failure | Behaviour | Client sees |
|---|---|---|
| identity down | Cached JWT verification still works (JWKS cached 5 min); login/register fail | 503 on auth routes; reads continue |
| JWKS unreachable and cache expired | **Fail closed** — cannot verify signatures | 503 |
| post down | Timeline serves cached bodies, omits the rest | 200 + `X-Degraded: post-hydration` |
| graph down | Composition omits relationship flags; timeline blocks fail closed | 200 + `X-Degraded` |
| search down | Empty results | 200, `degraded: true` in body |
| Redis down | Rate limiting fails open; idempotency **fails closed** on required routes | 503 on `POST /posts` |
| Any service breaker open | Fail fast, no queueing | 503 + `Retry-After` |

Idempotency fails closed while rate limiting fails open — deliberately. Losing rate limiting degrades protection; losing idempotency corrupts data.

---

## 10. Configuration

```
PORT · GRPC_<SERVICE>_ADDR (×6) · REDIS_URL
JWKS_URL · JWT_ISSUER · JWT_AUDIENCE · JWKS_CACHE_TTL_MS=300000
REQUEST_TIMEOUT_MS=5000 · MAX_BODY_BYTES=102400
RATE_LIMIT_CONFIG (JSON) · CORS_ORIGINS
OTEL_EXPORTER_OTLP_ENDPOINT · OTEL_SERVICE_NAME · LOG_LEVEL
NODE_OPTIONS=--max-old-space-size=384      # ← must be < the 512Mi container limit
```

The last line prevents the classic Node-in-Kubernetes failure: the default heap target ignores the cgroup limit, so the process is OOMKilled instead of collecting garbage (review H4).

---

## 11. Deployment

```yaml
replicas: 3                        # HPA 3–12
resources:
  requests: { cpu: 250m, memory: 384Mi }
  limits:   { cpu: 1000m, memory: 512Mi }
hpa:
  - cpu utilisation 70%
  - custom: http_requests_per_second > 600 per pod
podDisruptionBudget: minAvailable: 2
topologySpreadConstraints: maxSkew 1 across zones
terminationGracePeriodSeconds: 45
lifecycle.preStop: sleep 10        # drain endpoints before SIGTERM
```

The `preStop` sleep exists because pod termination and endpoint removal are concurrent, not ordered — without it, kube-proxy keeps routing to a pod that has already begun shutting down. Nest's `enableShutdownHooks()` then stops accepting new requests, drains in-flight ones, and closes gRPC channels.

---

## 12. SLIs

| SLI | Target | Source |
|---|---|---|
| Availability (non-5xx) | 99.9% | ingress |
| p99 latency, reads | < 250 ms | histogram by route |
| p99 latency, writes | < 400 ms | histogram by route |
| JWT verification p99 | < 2 ms | internal |
| Rate-limiter fail-open events | 0 | counter, alerts on any |
| Idempotent replays | tracked | counter — a rising rate means client retry storms |

---

## 13. Testing

- **Unit:** guards, interceptors, error mapping, idempotency state machine (all five branches in §5).
- **Integration (Testcontainers):** Redis-backed rate limiting under concurrency; idempotency with two simultaneous identical requests; JWKS rotation mid-flight.
- **Contract:** generated OpenAPI diffed against the committed spec; breaking changes fail CI.
- **E2E:** full auth → post → timeline → notification path against a compose stack.
- **Load:** k6 at 1,500 RPS with SLO assertions as pass/fail gates.

---

## 14. Open items

| # | Item | Default |
|---|---|---|
| 1 | Response caching (`ETag`/`If-None-Match`) on public profiles and posts | Deferred; add if egress cost matters |
| 2 | GraphQL surface for the timeline screen | Deferred (ADR-0006) |
| 3 | Per-client API keys and quotas for third parties | Not in v2 |
| 4 | Request signing for mobile clients | Not in v2 |
