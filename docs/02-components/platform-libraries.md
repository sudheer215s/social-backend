# Component Design — Platform Libraries (`libs/*`)

**Kind:** shared internal packages, not deployables
**Consumed by:** every app in `apps/`

The platform libraries are where correctness is made cheap. Every mechanism this design depends on — outbox, dedupe, deadline propagation, retry budgets, visibility rules — is a place where a per-service reimplementation would drift and, eventually, be subtly wrong in one service. Each is implemented once, tested once, and adopted by construction.

**Governing rule:** if a mechanism appears in two services, it belongs here. If it encodes a domain rule, it does not.

---

## `platform-config`

Typed, validated configuration. The process refuses to start on invalid config.

```ts
export const AppConfig = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  SERVICE_NAME: z.string(),
  LOG_LEVEL: z.enum(['trace','debug','info','warn','error']).default('info'),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().max(10).default(5),   // PgBouncer constraint
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z.string().transform(s => s.split(',')),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
});
```

Fail-fast at boot is the point: a service that starts with a missing `DATABASE_URL` and fails on the first request is far harder to diagnose than one that never becomes ready. `DATABASE_POOL_MAX` is capped at 10 **in the schema** — the connection budget (system design §3.6) is a real constraint, and a code-level cap enforces it better than a comment in a runbook.

No secrets in config objects that are ever logged; `toJSON` redacts anything matching `/pass|secret|token|key/i`.

---

## `platform-telemetry`

OpenTelemetry bootstrap, structured logging, health endpoints. Imported first in every `main.ts`, before any instrumented library loads.

```ts
export async function bootstrapTelemetry(cfg: AppConfig) { /* traces, metrics, logs */ }
```

- **Traces:** auto-instrumentation for HTTP, gRPC, `pg`, `ioredis`, `kafkajs`; tail-based sampling (all errors, all traces > 1 s, 1% of the rest).
- **Metrics:** RED per endpoint plus the platform metrics every service must expose (`outbox_depth`, `consumer_lag`, `dedupe_hits_total`, `breaker_state`).
- **Logs:** Pino, JSON, with `trace_id`/`span_id` injected automatically. A **redaction list** is applied at the serialiser: `password`, `token`, `authorization`, `refresh_token`, `email`, `ip`. Redaction lives here rather than at call sites because one careless `logger.info({ user })` is all it takes.
- **Health:** `/health/live` (event-loop responsiveness only) and `/health/ready` (dependency probes, cached 5 s). These are deliberately different — wiring liveness to a dependency means one Redis blip restarts the whole fleet (review H7).

---

## `platform-db`

Drizzle setup, PgBouncer-safe pooling, migrations, and transaction helpers.

```ts
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T>;
export async function withRetryOnSerialization<T>(fn: () => Promise<T>, max = 3): Promise<T>;
```

Enforced constraints, checked by an ESLint rule and by integration tests running **through PgBouncer**:

- No session-level state (`SET`, `LISTEN`, session advisory locks) — transaction pooling makes these silently wrong rather than loudly broken (ADR-0005).
- Statement timeout 5 s, lock timeout 3 s, `idle_in_transaction_session_timeout` 10 s — set per connection at checkout. A transaction that holds a lock indefinitely is the most common way one slow query becomes an outage.
- Every query carries an OTel span with the statement tag (not the parameters).

Migrations are forward-only SQL files, applied by a Kubernetes **Job that must complete before the rollout proceeds**, with expand/contract discipline documented in [`data-management.md`](../03-cross-cutting/data-management.md).

---

## `platform-events`

The largest library, and the one that carries the most correctness weight. It implements every mechanism from system design §9 so that no service implements them again.

### Outbox

```ts
await withTransaction(db, async (tx) => {
  const post = await tx.insert(posts).values(...).returning();
  await outbox.append(tx, {
    aggregateType: 'post', aggregateId: post.id,
    eventType: 'post.created', partitionKey: post.authorId, payload,
  });
});
```

`outbox.append` **requires a transaction handle**. It is impossible to publish an event outside the transaction that produced the state — the dual-write problem is closed by the type signature, not by discipline.

The relay (`SELECT … FOR UPDATE SKIP LOCKED`, 500-row batches, ordered by UUIDv7) runs as a separate deployable per owning service.

### Consumer runtime

```ts
@EventHandler({ topic: 'social.post.v1', group: 'timeline-fanout', eventTypes: ['post.created'] })
export class FanoutHandler implements Handler<PostCreated> {
  async handle(event: PostCreated, ctx: HandlerContext) { /* effect only */ }
}
```

The runtime provides, for every handler, without opt-in:

| Mechanism | Behaviour |
|---|---|
| Dedupe | `INSERT INTO processed_events (consumer_group, event_id) ON CONFLICT DO NOTHING` in the handler's transaction; 0 rows ⇒ skip |
| Transaction | Handler runs inside it; the dedupe row and the effect commit together |
| Offset commit | Manual, after commit |
| Retry ladder | Classify → `.retry.5s` → `.retry.1m` → `.retry.10m` → `.dlq`, never in-process backoff |
| Deserialisation | Protobuf via the schema registry; failures go straight to DLQ |
| Tracing | Trace context extracted from the envelope, so a producer's trace continues into the consumer |
| Metrics | `consumer_lag`, `handler_duration`, `dedupe_hits_total`, `retry_total`, `dlq_total` |
| Shutdown | SIGTERM finishes the in-flight batch, commits, then leaves the group |

The composite `(consumer_group, event_id)` key is baked into the library, which is the durable fix for review D1 — a per-service reimplementation is exactly how v1's single-column primary key would have survived review a second time.

Because the runtime owns the transaction and the dedupe row, a handler that is written as a pure effect is idempotent whether or not its author thought about idempotency. That is the design goal: make the correct thing the default thing.

---

## `platform-redis`

Cluster-aware client with the access patterns this system needs.

```ts
cache.getOrSet(key, ttl, loader)        // single-flight: one loader per key per process
limiter.check(key, limit, windowMs)     // atomic sliding window via Lua
scripts.load('fanout.lua')              // EVALSHA with NOSCRIPT fallback
stream.readGroup(...)                   // XREAD/XAUTOCLAIM wrapper
```

- **Single-flight** on cache miss. A viral post's cache entry expiring must not send thousands of concurrent identical queries at Postgres; only the first caller loads, the rest await the same promise.
- **Cluster-safe scripting.** Every script takes exactly one `KEYS` entry; cross-slot batching is handled by the client via pipelining, not by the script.
- **`EVALSHA` with `NOSCRIPT` fallback** — scripts vanish when a node restarts, and a service that cannot recover from that fails on every fan-out after a Redis restart.
- All Redis errors are typed as recoverable; **no Redis failure is allowed to produce a 5xx** without an explicit decision at the call site.

---

## `platform-grpc`

One client factory, so RPC policy cannot drift per service (api-gateway §7).

```ts
createClient<T>(proto, addr, {
  deadline: 'propagate',
  retry:   { max: 2, budget: 0.1, on: ['UNAVAILABLE','DEADLINE_EXCEEDED','RESOURCE_EXHAUSTED'] },
  breaker: { volumeThreshold: 20, errorThreshold: 0.5, halfOpenAfter: 15_000 },
});
```

- **Deadlines propagate; timeouts are never fixed.** A fixed timeout deep in a call chain outlives the client that is waiting on it and turns cancelled work into wasted capacity.
- **Retry budget (10%).** Uncapped retries amplify a partial outage into a total one — every client retrying triples load on a service that is already failing. This is the single most important line in the file.
- **Retries only on methods marked idempotent in the proto**, enforced by the factory rather than left to each caller.
- **Server side:** interceptors for tracing, metrics, deadline enforcement (reject already-expired requests without doing work), payload limits, and mTLS.

---

## `platform-authz`

The visibility rules from system design §11, implemented once.

```ts
export function canViewPost(viewer: ViewerContext, post: PostMeta, author: AuthorMeta): Decision;
export function canViewProfile(viewer: ViewerContext, target: AuthorMeta): Decision;
export function filterVisible<T>(viewer: ViewerContext, items: T[], project: (t: T) => Meta): T[];
```

Pure functions over an explicit context — no I/O, no clock, no globals. Callers supply the relationship context they have already fetched and cached.

This is deliberately a library rather than a service. Timeline, search, post, and notification all need the same rule on their hottest paths; a `canView` RPC would add a network hop to every item in every response. Sharing the *code* keeps the rule single-sourced without making it a runtime dependency.

Tested against a **table of viewer/author/relationship combinations** rather than example-by-example, so that adding a state (suspended, deactivated, erased) forces every existing combination to be re-decided rather than silently defaulting.

Returns `Decision = { allowed: boolean; reason: string }`. The reason is logged, never returned to clients — a denial reason confirms existence, which is exactly what the 404-not-403 rule exists to prevent.

---

## `platform-testing`

Testcontainers fixtures so integration tests are the default, not an aspiration.

```ts
const stack = await startTestStack({ postgres: true, redis: true, kafka: true });
```

- Postgres **behind PgBouncer**, so transaction-pooling violations fail in CI rather than under production load (risk R5).
- Redpanda for Kafka (single binary, fast startup).
- Redis in cluster mode, because cross-slot errors do not reproduce on a standalone instance — and every fan-out script depends on cluster semantics.
- Deterministic UUIDv7 and clock helpers for tests that assert on ordering.
- Per-test schema isolation via a template database (fast reset without re-running migrations).

The environment choices above are all cases where a *simpler* test environment would pass tests that production would fail. That is the whole point of the library.

---

## Dependency rules

```
apps/*        → libs/*          ✅
libs/*        → libs/platform-* ✅ (acyclic)
libs/*        → apps/*          ❌ enforced by ESLint boundaries
apps/* ↔ apps/*                 ❌ — cross-service calls go through generated gRPC clients only
```

Enforced by `eslint-plugin-boundaries` in CI. Without machine enforcement, `apps/post-service` importing a helper from `apps/identity-service` happens within weeks, and the service boundary becomes fiction while still costing a network hop.

---

## Versioning

Libraries are workspace-internal (`workspace:*`) and always built from source — no publishing, no version skew, and a breaking change is caught by compiling every consumer in one CI run. That is the main practical benefit of the monorepo (ADR-0001), and it is why a change to the consumer runtime's dedupe semantics cannot silently reach only half the fleet.
