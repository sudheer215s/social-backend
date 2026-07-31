# Architecture Decision Records

Each ADR records one decision, the alternatives that were genuinely considered, and what would cause us to revisit it. New decisions append here; superseded ADRs are marked, never deleted.

**Status values:** Accepted · Superseded by ADR-NNNN · Deprecated

| ADR | Decision | Status |
|---|---|---|
| [0001](#adr-0001) | pnpm monorepo, Nest apps/libs, strict TypeScript | Accepted |
| [0002](#adr-0002) | Service decomposition by data ownership; topology is separable | Accepted |
| [0003](#adr-0003) | UUIDv7 identifiers everywhere | Accepted |
| [0004](#adr-0004) | Drizzle ORM, SQL-first | Accepted |
| [0005](#adr-0005) | Database per service on a shared cluster, via PgBouncer | Accepted |
| [0006](#adr-0006) | gRPC internally, REST at the edge, Buf-managed protos | Accepted |
| [0007](#adr-0007) | Kafka + Protobuf + Schema Registry; transactional outbox | Accepted |
| [0008](#adr-0008) | At-least-once delivery, idempotent consumers, retry ladder | Accepted |
| [0009](#adr-0009) | Hybrid timeline fan-out over rebuildable Redis | Accepted |
| [0010](#adr-0010) | Identity service issues tokens; EdDSA + JWKS; rotating refresh | Accepted |
| [0011](#adr-0011) | Separate realtime gateway on Redis Streams | Accepted |
| [0012](#adr-0012) | OpenTelemetry-first; SLO burn-rate alerting | Accepted |
| [0013](#adr-0013) | GitOps with Argo CD; canary via Argo Rollouts; KEDA for consumers | Accepted |
| [0014](#adr-0014) | Elasticsearch for search; trending in Redis, not ES | Accepted |
| [0015](#adr-0015) | Block checks fail closed | Accepted |
| [0016](#adr-0016) | Reverse-chronological timeline in v2 | Accepted |

---

## ADR-0001
### pnpm monorepo with Nest apps/libs and strict TypeScript

**Status:** Accepted

**Context.** Eight deployables sharing protos, event contracts, telemetry bootstrap, and database plumbing. The existing repo is a single-app `nest new` scaffold with `strict` off (`noImplicitAny: false`, `strictBindCallApply: false`).

**Decision.**
- pnpm workspaces; Nest monorepo mode (`apps/*`, `libs/*`); Turborepo for task graph and CI caching.
- TypeScript `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- One version of every shared dependency, enforced by `pnpm dedupe --check` in CI.

**Alternatives.**
- *Polyrepo.* Real independence, but cross-cutting changes (an event schema touching four services) become multi-PR choreography. Not worth it below ~30 engineers.
- *Nx.* More capable generators and graph analysis than Turborepo, at a much larger conceptual surface. Turborepo does the one thing we need — cache the task graph.
- *Keep `strict` off.* Rejected outright. The entire correctness argument here rests on typed contracts across process boundaries; `noImplicitAny: false` silently discards exactly those guarantees at the boundary, which is where they matter most.

**Consequences.** Some initial friction enabling `noUncheckedIndexedAccess` (array access becomes `T | undefined`). Accepted: that is a genuine class of bug in code that indexes into batch RPC results by position.

**Revisit if** build times exceed ~5 minutes with a warm cache, or team size crosses ~30.

---

## ADR-0002
### Decompose by data ownership; keep deployment topology separable

**Status:** Accepted

**Context.** v1 defined seven services. Eight deployables is heavy for a product at 200K DAU (risk R7 in the system design).

**Decision.** Decompose logically by data ownership — one service per aggregate root, no shared tables, no cross-service SQL. Deploy each as a Nest module bound to a gRPC transport, so *deployment topology is a composition concern, not an architectural one*. Split physically only where scaling signals genuinely differ.

**Alternatives.**
- *Modular monolith.* Cheaper to operate and honestly a defensible choice here. Rejected because the fan-out consumers and the WebSocket gateway have scaling signals (Kafka lag, concurrent connections) that are incompatible with request-rate scaling in one process — those *must* be separate.
- *Finer split* (auth vs profile, likes vs posts). Premature; recorded as a §12.2 scale-out step instead.

**Consequences.** Every service pays for a gRPC hop, a deployment, a dashboard, and an on-call surface. The mitigation is that the module boundary is the real boundary: collapsing services into one process is a config change if load ever proves lighter than expected.

---

## ADR-0003
### UUIDv7 for all identifiers

**Status:** Accepted

**Context.** v1 used `gen_random_uuid()` (UUIDv4) for every primary key, and a millisecond timestamp as the timeline pagination cursor.

**Decision.** UUIDv7 — 48-bit Unix-millis prefix plus randomness — stored as `uuid`, for every entity ID.

**Why it resolves two problems at once.**
1. **Write locality.** Random v4 keys scatter inserts across the B-tree, causing page splits and WAL amplification on `posts`, `likes`, and `notifications` — the three highest-volume tables. v7 inserts land at the right edge.
2. **Total ordering.** The ID *is* a monotonic cursor. Timeline pagination keyed on a millisecond score (v1, §10.3) duplicates or skips posts sharing a millisecond across a page boundary. A v7 ID has no ties, so `ORDER BY id DESC` is a stable total order for both Postgres keyset pagination and Redis `ZRANGEBYLEX`.

**Alternatives.**
- *bigint identity.* Best index behaviour, but leaks volume, is enumerable, and complicates any future sharding.
- *Snowflake IDs.* Same ordering benefit, but requires node-ID coordination we would have to operate.
- *v4 + separate sort column.* Two things to keep consistent, and a wider index. Strictly worse.

**Consequences.** IDs leak creation time to ±1 ms. Acceptable — `created_at` is already public on every post. Requires Postgres 18's native `uuidv7()` or an application-side generator; we generate in the application so IDs exist before the insert (needed for the outbox row).

---

## ADR-0004
### Drizzle ORM, SQL-first

**Status:** Accepted

**Context.** v1 said "TypeORM/Drizzle" without deciding. The schema needs partial indexes, `FOR UPDATE SKIP LOCKED`, table partitioning, `ON CONFLICT DO NOTHING` with row counts, and keyset pagination.

**Decision.** Drizzle, with hand-written SQL migrations checked into the repo.

**Alternatives.**
- *Prisma.* Best DX in the ecosystem, but a separate query engine process, weaker escape hatch for the SQL above, and its connection handling fights PgBouncer transaction pooling (ADR-0005).
- *TypeORM.* Nest's default and well-integrated, but its migration story and query builder both degrade on exactly the features listed above. Its `synchronize` mode is a production footgun we would then need to police.
- *Raw `pg` + a query builder.* Maximum control, no type safety at the boundary — the thing we are optimising for.

**Consequences.** Less magic; more SQL in code review. That is the intent — every one of the operations listed above is one we want reviewers to actually read.

---

## ADR-0005
### One database per service on a shared cluster, always through PgBouncer

**Status:** Accepted

**Context.** "Database per service" is the pattern; a cluster per service is the cost. Separately, 8 services × 3 replicas × a default pool of 10 exhausts `max_connections` on the first realistic deploy (review C7).

**Decision.** One Postgres cluster; one **database** per service; one role per service with no cross-database grants. All access through PgBouncer in transaction pooling mode (`default_pool_size=20`/db), with small application pools (`max: 5`).

**Alternatives.**
- *Shared database, schema per service.* Cheapest, but a `GRANT` mistake or a convenient join erodes the boundary silently.
- *Cluster per service.* Correct isolation, 4× the cost and 4× the operational surface at this scale.
- *Session pooling instead of transaction pooling.* Preserves session state but does not actually solve connection multiplication.

**Consequences — binding on application code.** Transaction pooling forbids session-level state: no `SET` outside a transaction, no advisory locks held across statements, no `LISTEN`. Server-side prepared statements need PgBouncer ≥ 1.21. These are easy to violate accidentally and only fail under load, so **CI integration tests run through PgBouncer, not against Postgres directly**.

**Revisit** at the §12.2 threshold, where splitting is a connection-string change because roles are already separate.

---

## ADR-0006
### gRPC internally, REST at the edge, protos managed by Buf

**Status:** Accepted

**Decision.** Public API: REST/JSON with OpenAPI. Internal: gRPC unary over HTTP/2, protos in `proto/` managed by Buf. `buf lint` and `buf breaking` run in CI against the main branch.

**Alternatives.**
- *REST internally.* Simpler tooling, no schema enforcement, no generated clients, no breaking-change detection. The last point is the decisive one: with eight independently deployed services, a breaking contract change must be caught in CI, not in staging.
- *GraphQL at the edge.* Genuinely attractive for a timeline BFF (clients fetch exactly what they render). Rejected for v2: it moves query cost control to the client, which interacts badly with the fan-out and hydration budgets in §10.5. Reconsider once the read path is stable.
- *gRPC-Web to clients.* Poor browser cache/CDN story, worse debuggability.

**Consequences.** Two contract surfaces to keep aligned. Mitigated by generating REST DTOs from the same protos where shapes coincide, and by contract tests. **No server-streaming RPCs** — v1's `GetPostsForTimeline` streamed a bounded page for no benefit while complicating retry and circuit-breaker wrapping (review B6).

---

## ADR-0007
### Kafka with Protobuf and a schema registry; transactional outbox for publication

**Status:** Accepted

**Context.** At 145 msg/s peak, throughput does not justify Kafka. Durable replay, independent consumer groups, and per-key ordering do.

**Decision.** Kafka with `replication.factor=3`, `min.insync.replicas=2`, `acks=all`. Events are Protobuf in a versioned envelope, registered with `BACKWARD_TRANSITIVE` compatibility enforced by `buf breaking` in CI. Publication is via transactional outbox with a `FOR UPDATE SKIP LOCKED` relay. Redpanda locally (Kafka-compatible, single binary, no ZooKeeper).

**Alternatives.**
- *Direct produce from the request handler.* The dual-write problem: the database commits and the produce fails, or vice versa. Non-negotiable.
- *Debezium CDC instead of an outbox.* Removes the relay and the polling latency, but couples consumers to table shape and adds Kafka Connect to operate. Documented as the scale-up option once outbox polling becomes a bottleneck.
- *JSON events.* What v1 specified. No compatibility enforcement means the first additive change breaks a consumer in production (review D2).
- *NATS JetStream / SQS.* Lighter to operate; weaker replay and consumer-group semantics, and no per-key ordering guarantee.

**Consequences.** Kafka is the heaviest thing we operate. Justified by replay: rebuilding the search index or a timeline from a topic is a routine operation, and it is what makes derived stores safely disposable.

---

## ADR-0008
### At-least-once delivery with idempotent consumers and a non-blocking retry ladder

**Status:** Accepted

**Context.** v1 titled this "Exactly-Once Semantics" and gave the dedupe table `event_id` as its sole primary key.

**Decision.**
- Delivery is **at-least-once**; processing is **effectively-once** via a dedupe table keyed `(consumer_group, event_id)`. The composite key is required — `social.post.v1` has four consumer groups, and v1's single-column key would let the first group to process an event suppress it for the other three (review D1).
- The dedupe insert and the effect share one transaction; the Kafka offset commits after.
- Retries use a non-blocking ladder (`.retry.5s` → `.retry.1m` → `.retry.10m` → `.dlq`), never in-process backoff, which stalls the partition behind a poison message.

**Alternatives.**
- *Kafka transactions (`processing.guarantee=exactly_once_v2`).* Real, but only covers Kafka-to-Kafka. Our effects land in Postgres, Redis, and Elasticsearch, so we would still need idempotent handlers — all cost, no benefit.
- *Offset-only tracking.* Cheaper, but a crash between effect and offset commit replays the effect. Only safe if every effect is naturally idempotent, which is not true of counter increments.

**Consequences.** Every handler must be idempotent and every developer must know it. The naming discipline here is deliberate: calling it "exactly-once" is how that requirement gets forgotten.

---

## ADR-0009
### Hybrid fan-out over a rebuildable Redis timeline

**Status:** Accepted

**Decision.** Fan-out on write to followers with a materialised timeline; fan-out on read for accounts above 50,000 followers; merge at read time. Timelines are Redis sorted sets, capped at 400 entries, TTL 14 days refreshed on read, **evictable and rebuildable from Postgres**.

Two mechanisms carry most of the weight:

- **Key existence is the activity signal.** Because the TTL refreshes on read, `tl:h:{uid}` exists exactly when its owner read their timeline in the last 14 days. Fan-out writes only to existing keys, so it naturally targets active users — no separate activity set to maintain, no second source of truth to drift. This alone cuts fan-out volume ~5× (§3.2).
- **Timelines are disposable.** Redis may evict any timeline at any time; the read path rebuilds it. This is what makes the memory budget safe, and it is why v1's "no TTL, 1M users" plan (~140 GB, review E1) was unaffordable while this one is ~7 GB.

**Alternatives.**
- *Pure fan-out on write.* One post by a 5M-follower account = 5M writes.
- *Pure fan-out on read.* ~200 ms+ per read at a 40:1 read:write ratio. Wrong side of the trade.
- *Durable timelines (Cassandra).* Removes the rebuild path but adds a datastore to operate for data that is, by definition, derivable.

**Consequences.** The rebuild path is a real, load-bearing code path — not a fallback. It must be bounded (200-concurrency limiter), instrumented, and chaos-tested (risk R2), because a Redis failover makes it the *only* path for every user at once.

---

## ADR-0010
### The identity service issues tokens; EdDSA with JWKS; rotating refresh with reuse detection

**Status:** Accepted

**Context.** v1 had the API gateway mint JWTs after the user service validated credentials, used RS256 with no `kid` and no rotation mechanism, and issued non-rotating 7-day refresh tokens.

**Decision.**
- **Identity service issues; gateway only verifies.** The service that owns credentials, sessions, and revocation owns token issuance. The signing key does not live in the most exposed, highest-replica component.
- **EdDSA (Ed25519)** with a `kid` header; public keys served from a JWKS endpoint the gateway caches for 5 minutes. Two keys live at any time to make rotation a non-event.
- Access token 10 min, carrying `sub`, `sid`, `jti`, `iss`, `aud`, `kid`.
- **Rotating refresh tokens with reuse detection**: each use issues a new token and invalidates the old one; presenting an already-used token revokes the entire session family and alerts. This is the mechanism that makes a stolen refresh token detectable — v1 had none.
- Argon2id for password hashing (bcrypt silently truncates at 72 bytes).

**Alternatives.**
- *Opaque tokens with introspection.* Instant revocation, at the cost of an identity-service call on every request — a hard availability coupling on the hottest path.
- *RS256.* Fine, but larger signatures and slower verification than Ed25519 for no benefit.
- *Long-lived non-rotating refresh tokens.* Simpler and undetectably compromised.

**Consequences.** Access tokens cannot be revoked before expiry; the 10-minute window is the accepted exposure, and `sid` allows the gateway to check a small revocation set for the high-value case (password change, explicit "log out everywhere").

---

## ADR-0011
### Separate realtime gateway backed by Redis Streams

**Status:** Accepted

**Context.** v1 placed WebSocket handling in the API gateway and delivered notifications over Redis pub/sub.

**Decision.** A separate `realtime-gateway` deployable. Delivery via a per-user Redis **Stream** (`ntf:s:{uid}`, `MAXLEN ~ 200`), read with a per-connection cursor.

**Why separate.** Long-lived stateful connections and stateless HTTP have incompatible operational profiles: different scaling signals (concurrent connections vs RPS), different memory curves, different deploy cadences. Sharing a deployment means every gateway rollout drops every WebSocket.

**Why streams, not pub/sub.** Pub/sub is fire-and-forget: a user not connected at that instant loses the message, with no replay. A stream gives at-least-once delivery, a resumable cursor, and catch-up on reconnect via `last_seen_id`. Separately, Redis Cluster broadcasts non-sharded pub/sub to every node — the v1 design's "all instances subscribe to all channels" scales as O(instances × users).

**Alternatives.**
- *Server-Sent Events.* Simpler, unidirectional, better proxy behaviour. Genuinely competitive; rejected only because typing indicators and client acks are likely near-term additions.
- *Postgres `LISTEN/NOTIFY`.* Incompatible with PgBouncer transaction pooling (ADR-0005), and not durable.
- *Managed push (Ably/Pusher).* Removes real operational load. Reasonable fallback if realtime becomes a distraction.

**Consequences.** Notification streams are ~10 GB of Redis at the design point (risk R3) — the second-largest consumer. If it exceeds budget, the fallback is to keep only a "since" pointer in Redis and replay from Postgres.

---

## ADR-0012
### OpenTelemetry-first, with SLO burn-rate alerting

**Status:** Accepted

**Context.** v1 scheduled all observability for weeks 15–16, after every asynchronous path had been built. Its alerts were static thresholds with no SLOs.

**Decision.** OpenTelemetry SDK from the first commit: traces, metrics, and logs correlated by trace ID. Prometheus scrape, Tempo for traces, Loki for logs, Grafana on top. Pino for structured logs, trace context injected. Alerting on **SLO burn rate** (multi-window, multi-burn), not raw thresholds, with a runbook link required on every alert rule.

**Why first.** A fan-out bug spanning gateway → post → Kafka → timeline → Redis is not debuggable by reading logs from five services. Retrofitting instrumentation across eight services costs several times what building with it costs, and the phases that most need it (3–6) are precisely the ones v1 scheduled before it.

**Alternatives.**
- *Vendor SDK (Datadog/New Relic).* Better out-of-box; vendor lock-in on instrumentation. OTel keeps the exporter swappable — including to a vendor.
- *Static threshold alerts.* `rate(5xx) > 1% for 5m` pages at 3am for a blip and stays silent through a slow burn. Burn-rate alerting is proportional to actual user harm.

**Consequences.** Trace sampling needs care: 100% head sampling at 1,500 RPS is expensive. Tail-based sampling — keep all errors and slow traces, 1% of the rest.

---

## ADR-0013
### GitOps with Argo CD, canary via Argo Rollouts, KEDA for consumers

**Status:** Accepted

**Context.** v1 deployed via `kubectl apply -k` from CI, using the `:latest` image tag, with no canary and no defined rollback.

**Decision.** Helm charts per service, environment overlays, Argo CD reconciling from git. Argo Rollouts for canary with automated analysis (error rate + p99 latency) and automatic abort. Images tagged by immutable digest. HPA on CPU and RPS for request-serving services; **KEDA on Kafka consumer lag** for consumers.

**Why KEDA for consumers.** A consumer that is behind is not necessarily using CPU — it may be blocked on a downstream call. Lag is the signal that matters and the one the SLO is written against. KEDA also scales to zero for low-volume consumers, and caps at the partition count, which is the real parallelism ceiling.

**Alternatives.**
- *`kubectl apply` from CI.* Push-based, no drift detection, cluster credentials in CI.
- *Flux.* Equivalent; Argo's UI is worth more to a small team.
- *Blue/green.* Doubles resource cost during rollout and gives a coarser signal than a 10% canary.

**Consequences.** `:latest` is banned. Digest pinning makes rollback a git revert with a deterministic result.

---

## ADR-0014
### Elasticsearch for search; trending computed in Redis

**Status:** Accepted

**Decision.** Elasticsearch 8 for post and user search, populated by a Kafka consumer using bulk indexing with alias-based zero-downtime reindex. **Trending hashtags are computed in Redis**, not by Elasticsearch aggregation.

**Why trending moves out of ES.** v1 computed trending with `Score = (recent_count / total_count) * log(total_count + 1)` over the posts index. That is a full aggregation over a large index, on a user-facing endpoint, with no caching story. Redis instead: `INCR` a 5-minute time bucket per hashtag on `post.created`, and a 5-minute job rolls the last 288 buckets into a sorted set. Reads become one `ZREVRANGE`, and the write cost is one `INCR` per hashtag per post.

**Alternatives.**
- *Postgres full-text search.* Genuinely sufficient at 36M posts and removes a whole datastore. The deciding factor is relevance tuning and fuzzy matching on usernames — Postgres does this poorly. Recorded as a real simplification if search stays a secondary feature.
- *OpenSearch.* License-driven fork; equivalent technically. Choose by what the target cloud manages well.
- *Meilisearch/Typesense.* Much simpler to operate, weaker at scale and at aggregations.

**Consequences.** Elasticsearch is the least-owned component and the most likely to be operated poorly (risk R4). Search failures are therefore non-fatal by design: empty results plus a degraded flag, never a 5xx. Nightly reconciliation against Postgres alerts on divergence > 0.1%.

---

## ADR-0015
### Block checks fail closed

**Status:** Accepted

**Context.** Every other read-path dependency degrades gracefully — stale profile, missing count, omitted post. Blocks are different: a stale block leaks content to someone the user explicitly excluded.

**Decision.** When block state cannot be determined (graph-service unavailable and cache expired), the timeline read path hides posts from any author not in the reader's follow set. Block writes force-invalidate the reader's cache synchronously before returning, so a block takes effect on the next read.

**Alternatives.**
- *Fail open.* Higher availability; a privacy incident during any graph-service outage. Users experience a blocked person reappearing as a product failure, and correctly so.
- *Replicate block lists into the timeline service.* Removes the dependency but duplicates the data and creates its own staleness window.

**Consequences.** A graph-service outage degrades timelines for users who follow few accounts, which is a visible but honest failure. This is the one place in the design where we choose correctness over availability, and it is deliberate. Recorded here so it is not "fixed" later by someone optimising availability.

---

## ADR-0016
### Reverse-chronological timeline in v2

**Status:** Accepted

**Decision.** The home timeline is strictly reverse-chronological. No ranking, no injected recommendations.

**Rationale.** Ranking requires a feature store, a model serving path, and an evaluation loop — a larger project than the entire rest of this system, and one that cannot be validated without traffic we do not have. Reverse-chronological is also the only ordering with a *stable, cheap cursor*, which is what makes §10.5's pagination guarantees possible.

**Consequences.** The read path deliberately over-fetches (`limit × 3`) so that a scoring step can be inserted between filtering and hydration without restructuring. Because that step would break cursor stability, **clients must treat `next_cursor` as opaque** — enforced now, while it is still true, so that adding ranking later is not a breaking API change.
