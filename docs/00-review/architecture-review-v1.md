# Architecture Review — Existing Design (v1.0)

**Reviewer role:** Senior engineer / system architect
**Date:** 2026-07-31
**Inputs reviewed:**
- `twitter-linkedin-distributed-backend-design.md` (v1.0, 2311 lines)
- `implementation-plan-8-phases.md` (16-week plan)
- Repository state (`src/`, `package.json`, `tsconfig.json`)

---

## 1. Verdict

The v1 design is a **competent survey of the right patterns** — outbox, fan-out on write, idempotent consumers, circuit breakers, CQRS-ish read models — and the service decomposition is sensible. It reads as a strong *systems-design interview answer*.

It is **not yet a buildable production design**. Three classes of problem:

1. **Undischarged obligations.** Several mechanisms are named but never specified to the point where an engineer could implement them (the hybrid celebrity read path, timeline removal on delete, notification aggregation, password reset, private accounts).
2. **Correctness defects.** A handful of designs are wrong as written and will produce data corruption or duplicates in production (dedupe table PK, counter maintenance, offset-based fan-out pagination, score-only ZSET cursor).
3. **No quantitative basis.** There is no capacity model. The performance targets (10K RPS) are not derived from the user model (1M users) and are inconsistent with it by roughly an order of magnitude. Without sizing, every "Redis Cluster: 6 nodes" style statement is a guess.

Additionally, the repository contains **no implementation** — it is an unmodified `nest new` scaffold with TypeScript strictness disabled.

**Recommendation:** rebase onto a v2 design (produced in `docs/01-architecture/`) that fixes the defects, adds a capacity model, and reorders the delivery plan so that observability, CI, and security baselines land *first* rather than last.

---

## 2. Severity scale

| Level | Meaning |
|---|---|
| **S1** | Correctness/security defect, or a design that cannot be implemented as written. Must fix before build. |
| **S2** | Will cause an incident, cost overrun, or expensive rework at the design point. Fix before the relevant phase. |
| **S3** | Quality, consistency, or maintainability. Fix opportunistically. |

---

## 3. Findings

### A. Requirements & sizing

| # | Sev | Finding |
|---|---|---|
| A1 | **S1** | **Targets are not derived and are mutually inconsistent.** §1.3 states 1M users; §4.1 states 10K RPS sustained. 10K RPS against 1M registered users implies every user issuing ~1 request/second continuously. A realistic model (20% DAU, ~60 API calls/user/day) yields **~140 RPS average, ~700–1,500 RPS peak** — 7–70× lower. Every downstream sizing decision (Redis node count, Kafka partitions, replica counts) inherits this error. |
| A2 | **S2** | **No capacity model at all.** No derivation of writes/sec, fan-out amplification, Redis memory, Postgres growth, Kafka throughput, or connection counts. "Redis Cluster: 6 nodes (3 masters, 3 replicas)" is asserted, not computed. |
| A3 | **S2** | **99.9% availability with no error budget, no RPO/RTO, no DR plan.** §4.3 gives per-component targets but there is no composition (7 services at 99.9% in series ≈ 99.3% end-to-end), no backup/restore procedure, and no regional failure story. |
| A4 | **S2** | **No data lifecycle requirements.** The system stores PII (email, IP address in `refresh_tokens`, bio) and replicates it into Elasticsearch and Kafka (7-day retention). There is no retention policy, no account-deletion cascade, and no right-to-erasure design. Kafka retention of PII is a compliance problem that must be designed for (crypto-shredding or compacted topics with tombstones), not discovered later. |
| A5 | **S3** | **No cost model.** Kafka (3 brokers) + Elasticsearch (3 nodes) + Redis (6 nodes) + Postgres is a five-figure-per-month baseline. For a 200K-DAU system this is heavily over-specified; the doc should state the cost/complexity tradeoff and a smaller starting topology. |

### B. Architecture & service boundaries

| # | Sev | Finding |
|---|---|---|
| B1 | **S1** | **Timeline Service "Owns: Nothing (uses Redis as primary store)" (§6.2).** A service whose entire dataset lives in an evictable, non-durable cache with **"TTL: No TTL"** (§10.1) has no defined behaviour on cache loss. §14.4 offers a Postgres fallback query, but that query (`WHERE author_id IN (following_ids)`) is unbounded and unindexed for a user following 5,000 accounts. **The rebuild path must be a first-class, bounded, tested design — not a footnote.** |
| B2 | **S1** | **The hybrid fan-out read path is undefined.** The plan says: if `follower_count > 10000`, "don't fan-out; mark post for pull strategy; fans of celebrities pull on read." Nowhere is it specified *how the read merges the two sources*: how the reader learns which of the accounts they follow are "large", how pulled posts are merged and ordered against the materialised set, how pagination stays stable across the merge, or how the merge is bounded. This is the single largest hole in the document — it is the core algorithm of the product. |
| B3 | **S1** | **"Remove post from all timelines" (§10.4) is not implementable.** A post may exist in 100K Redis sorted sets and there is **no reverse index from post → timelines**. §10.3 lists `ZREM timeline:{user_id} {post_id}` as if the set of user_ids were known; it is not. The only workable designs are (a) filter deleted posts at hydration time, or (b) maintain a reverse index — and (a) is correct. |
| B4 | **S2** | **WebSocket handling is placed inside the stateless API Gateway (§6.2).** This couples long-lived stateful connections to the component that must scale and roll on HTTP request volume. A gateway rollout drops every WebSocket. The two have different scaling signals (RPS vs concurrent connections), different memory profiles, and different deploy cadences. They must be separate deployables. |
| B5 | **S2** | **Missing components implied by the requirements.** The design assumes but never defines: an **email/verification sender** (registration verification and password reset are in the API surface), a **media** story (media_urls are accepted and never validated — an SSRF and abuse vector), **moderation/abuse** handling, an **admin/back-office** surface (§4.5 mentions "RBAC for admin operations" with no admin service), and **batch/maintenance jobs** (outbox cleanup, dedupe-table pruning, counter reconciliation, ES reindex). |
| B6 | **S3** | **`GetPostsForTimeline` returns `stream Post` (§8.2.2).** Server streaming for a bounded page of ≤100 items adds client complexity, breaks simple retry/circuit-breaker wrapping, and buys nothing. Use a unary batch RPC. |
| B7 | **S3** | **Dependency diagram contradicts the service boundaries.** §6.3 says "Notification Service: Calls User Service (preferences)" while §6.2 says Notification consumes events only; §6.3 omits Timeline→Graph which §5.3.1 requires. |

### C. Data model & persistence

| # | Sev | Finding |
|---|---|---|
| C1 | **S1** | **Counter maintenance is specified two incompatible ways, and both are wrong.** §8.2.1 exposes `IncrementFollowerCount`/`DecrementFollowerCount` gRPC methods; §6.2 and the phase plan say counts are synced from `graph.events` via the `user-counter-sync` consumer group; Phase 2 Day 3–4 says "Counter updates via gRPC". Pick one. The gRPC version is **not idempotent** — any retry (and the design mandates retries with `UNAVAILABLE` in the retryable set, §14.3) double-counts. The event version is only correct if the consumer dedupes, which brings us to D1. |
| C2 | **S1** | **`likes` table will reach ~730M rows/year unpartitioned.** At the design point (200K DAU × ~10 likes/day = 2M/day), `likes` is by far the largest table. It is defined as a plain heap with two secondary indexes and no partitioning or archival strategy. Vacuum, index bloat, and `idx_likes_post_id` growth become operational problems within months. |
| C3 | **S1** | **Random UUIDv4 primary keys everywhere.** `gen_random_uuid()` produces random values, causing B-tree page splits and write amplification on every insert into `posts`, `likes`, `notifications` — the three highest-volume tables. Time-ordered UUIDv7 gives sequential insert locality *and* makes the ID itself a valid pagination cursor (see E3). |
| C4 | **S2** | **Hot-row contention on `posts.like_count`.** `UPDATE posts SET like_count = like_count + 1 WHERE id = :post_id` serialises every like on a viral post through a single row lock. At 1K likes/sec on one post this is a hard throughput ceiling and a lock-wait pileup. |
| C5 | **S2** | **`GREATEST(like_count - 1, 0)` (Phase 2) silently masks bugs.** Clamping hides double-decrements instead of surfacing them. The invariant should be enforced by a `CHECK (like_count >= 0)` constraint and the count derived from the `likes` table, which is the actual source of truth. |
| C6 | **S2** | **Soft deletes with no partial indexes.** `is_deleted BOOLEAN DEFAULT FALSE` is used for posts, but every index in §7.3 covers deleted rows too. Indexes should be `WHERE is_deleted = false`. There is also no policy for what a reply thread renders when its parent is deleted, nor for `repost_of_id` pointing at a deleted post. |
| C7 | **S2** | **No connection-pool budget.** 7 services × 3 replicas × a default pool of 10 = 210 connections against a Postgres `max_connections` that defaults to 100. This will fail on the first realistic deploy. PgBouncer (transaction pooling) is mandatory and is not mentioned anywhere. |
| C8 | **S2** | **No migration strategy.** No expand/contract discipline, no statement about `ALTER TABLE` locks on large tables, and no defined ordering between migration jobs and rolling pod updates. A rolling deploy where old and new code run concurrently against one schema is the normal case and must be designed for. |
| C9 | **S3** | **Inconsistent key types.** `hashtags.id` is `SERIAL` while every other PK is UUID. `post_hashtags` has no case-folding/normalisation rule, so `#NestJS` and `#nestjs` become distinct hashtags. |
| C10 | **S3** | **`follows` lacks a covering index for keyset pagination.** `idx_follows_follower_id` alone forces a heap lookup per row for `ORDER BY created_at DESC`; needs `(follower_id, created_at DESC, following_id)`. |
| C11 | **S3** | **`§7.1 "Database per Service"` actually describes schemas in one instance.** That is a reasonable cost decision, but it must be stated as *logical* isolation with enforcement (separate roles, no cross-schema grants), otherwise the boundary erodes the first time someone writes a join. |

### D. Event streaming

| # | Sev | Finding |
|---|---|---|
| D1 | **S1** | **The dedupe table's primary key is wrong.** The phase plan defines `processed_events(event_id UUID PRIMARY KEY, consumer_group VARCHAR, processed_at TIMESTAMP)`. `post.events` is consumed by **three** consumer groups (timeline-fanout, search-indexer, notification-processor). With `event_id` as the sole PK, the first group to process an event blocks the other two from recording it — and, depending on the insert path, either crashes on conflict or causes the other consumers to skip the event entirely. **The PK must be `(consumer_group, event_id)`.** This is a silent data-loss bug. |
| D2 | **S1** | **No schema registry, no event versioning, no compatibility policy.** §9.2 defines events as untyped JSON with no `version` field. Producers and consumers deploy independently; without a registry and an enforced compatibility rule, the first additive change to `post.created` breaks a consumer in production. The design already uses Protobuf for gRPC — the same discipline must apply to events. |
| D3 | **S1** | **The outbox poller has no concurrency control or ordering guarantee.** §9.6 says "background worker publishes from outbox / delete after ACK". Missing: how multiple relay replicas avoid publishing the same row (needs `SELECT ... FOR UPDATE SKIP LOCKED`), how per-aggregate ordering is preserved when publishing in parallel, how the Kafka partition key is derived from the outbox row, and what happens when the relay crashes between publish and mark-published (at-least-once — which is fine, but must be stated). |
| D4 | **S2** | **"Exactly-Once Semantics" (§9.6) is a misnomer.** What is described is at-least-once delivery plus idempotent consumers, i.e. *effectively-once processing*. The distinction matters because it dictates that **every** consumer handler must be idempotent — a requirement that gets dropped if engineers believe the transport guarantees uniqueness. |
| D5 | **S2** | **No retry topics; DLQ has no redrive path.** §14.6 defines a DLQ message schema and says "Transient: schedule retry with backoff". In-process retry with backoff on a Kafka consumer **blocks the partition** — one poison message stalls every message behind it. The standard fix is non-blocking retry topics (`.retry.5s`, `.retry.1m`, `.retry.10m`) with a terminal DLQ, plus tooling and a runbook to inspect and redrive. Neither exists. |
| D6 | **S2** | **Cross-topic ordering is assumed but not guaranteed.** `notification-processor` consumes `post.events` (keyed by `author_id`) and `graph.events` (keyed by `following_id`). Nothing orders these relative to each other, so a `post.liked` can be processed before the `post.created` it refers to. Handlers must tolerate out-of-order and missing referents. |
| D7 | **S3** | **Consumer concurrency is not constrained by partition count.** §9.4 assigns concurrency 10 to `timeline-fanout` on a 20-partition topic (fine) but the rule — *effective parallelism ≤ partition count* — is never stated, and partition counts cannot be reduced later. |
| D8 | **S3** | **`user.deleted` → "cascade unfollow" is modelled as an event handler.** Deleting up to millions of graph edges is a long-running batch job with checkpointing, not a message handler with a 30-second session timeout. |

### E. Caching

| # | Sev | Finding |
|---|---|---|
| E1 | **S1** | **`timeline:{user_id}` has "TTL: No TTL" and a 1,000-entry cap, for 1M users.** That is 1M sorted sets × 1,000 members. With 36-char UUID members, Redis skiplist overhead puts this near **140 GB** — against an asserted 6-node cluster with no memory budget. The design must (a) materialise timelines only for *active* users, (b) shrink the window, (c) shorten the member encoding, and (d) make timelines **evictable and rebuildable**, which resolves B1 at the same time. |
| E2 | **S2** | **Fan-out reads the follower list from a 15-minute cache** (`followers:{user_id}`, §10.1). A follow created 30 seconds ago is invisible to fan-out, so the new follower silently misses posts with no repair path. Fan-out must read the source of truth. |
| E3 | **S2** | **Score-only cursor over a sorted set drops and duplicates posts.** §10.3 paginates via `ZREVRANGEBYSCORE timeline:{id} +inf {cursor} LIMIT 0 20` where the score is a millisecond timestamp. Two posts sharing a millisecond straddling a page boundary are either returned twice or skipped. The cursor must be a total order — which UUIDv7 post IDs provide for free (see C3). |
| E4 | **S3** | **`session:{token}` puts the raw bearer token in the Redis keyspace**, where it appears in `MONITOR` output, slowlogs, and keyspace scans. Key on a hash of the token. |
| E5 | **S3** | **Redis Cluster plan is under-considered.** §10.5 proposes `{user_id}` hash tags to co-locate `timeline:{user_id}` and `user:{user_id}` — but these are never accessed in the same multi-key operation, so the co-location buys nothing while creating hot slots for large accounts. Separately, Redis Cluster broadcasts non-sharded pub/sub to **every** node, which interacts badly with the §12.3 notification design. |

### F. Security & authorization

| # | Sev | Finding |
|---|---|---|
| F1 | **S1** | **`private_account` exists in the schema with no authorization design anywhere in the document.** As designed, a private user's posts are fanned out to follower timelines, indexed into Elasticsearch, and returned by `GET /posts/:id` and `/search/posts` with no visibility check. **This is a privacy breach shipped by omission.** Authorization is mentioned once ("RBAC for admin operations") and otherwise absent: there is no model for who may read a post, who may see a follower list, or what a private account changes. |
| F2 | **S1** | **JWT design is incomplete in ways that matter.** The access token (§11.2) carries no `jti`, `kid`, `iss`, or `aud`. Without `kid` there is no key rotation; the phase plan mandates RS256 but never mentions a JWKS endpoint, key storage, or rotation procedure. Refresh tokens are stored hashed (good) but there is **no rotation and no reuse detection** — a stolen refresh token is valid for its full 7 days with no way to detect or sever the session family. |
| F3 | **S1** | **Token-issuing authority is split.** §11.1 has the API Gateway mint JWTs after the User Service validates credentials. The signing key then lives in the most exposed, highest-replica-count component, while the service that owns credentials, sessions, and revocation cannot issue or revoke. The service that owns the session lifecycle must own token issuance. |
| F4 | **S2** | **Password reset and email verification are exposed as endpoints with no design and no owning component.** `POST /auth/forgot-password` and `/auth/reset-password` appear in §8.1.1; the phase plan marks the flow "(optional)". There is no token model, no expiry, no single-use guarantee, no rate limit, no enumeration-resistance requirement, and no email sender in the service inventory. |
| F5 | **S2** | **The idempotency design is orphaned.** §14.5 specifies an `idempotency_keys` table and an `Idempotency-Key` header flow in detail — and no endpoint in §8.1 requires it. `POST /posts` retried by a mobile client on a flaky network creates duplicate posts. |
| F6 | **S2** | **No blocking, muting, or abuse controls.** Blocking is table stakes for a social product and has deep architectural reach (timeline filtering, notification suppression, search filtering, follow prevention, reply visibility). Retrofitting it after fan-out is built is expensive. Rate limits exist, but there is no spam/velocity/abuse detection and no report/moderation path. |
| F7 | **S2** | **Secrets are planned as a committed manifest.** The phase plan's Kubernetes tree contains `k8s/base/secrets.yaml`. Kubernetes Secrets are base64, not encrypted; committing them to git is a credential leak. Needs External Secrets Operator or SOPS. |
| F8 | **S2** | **mTLS with "certificate rotation: 90 days" has no mechanism.** Manual certificate rotation across 8 services does not happen. This needs a service mesh or SPIFFE/SPIRE — or the requirement should be honestly downgraded. |
| F9 | **S3** | **WebSocket hardening is absent.** No per-user connection limit, no inbound message rate limit, no maximum frame size, and — importantly — no defined behaviour when the access token expires *during* a long-lived connection. |
| F10 | **S3** | **bcrypt cost 12** is acceptable but Argon2id is the current recommendation, and bcrypt silently truncates inputs beyond 72 bytes. |
| F11 | **S3** | **`media_urls` is accepted as arbitrary user-supplied URLs** and validated only for "format, whitelist protocols". Any server-side fetch of these (link previews, ES enrichment) is an SSRF vector; rendering them is an abuse vector. |

### G. API design

| # | Sev | Finding |
|---|---|---|
| G1 | **S1** | **Route collision.** §8.1.2 defines both `GET /api/v1/users/:username` and `GET /api/v1/users/:id/followers`. Two different path parameter *types* occupy the same positional segment; `GET /users/alice` and `GET /users/{uuid}` are indistinguishable to the router without content sniffing, and `PATCH /users/me` collides with a user literally named `me`. |
| G2 | **S2** | **No API conventions.** No standard error envelope (RFC 9457 `application/problem+json`), no standard pagination envelope, no rate-limit header contract on all endpoints, no deprecation/versioning policy beyond `/v1` in the path, no `Idempotency-Key` contract, no request-size limits. |
| G3 | **S2** | **`GetFollowerIds(user_id, limit, offset)` uses offset pagination — in the fan-out hot path.** Paging through 500K followers with `OFFSET` is quadratic: the database re-scans and discards every preceding row on each page. Fan-out for a large account degrades from linear to quadratic. Must be keyset pagination. |
| G4 | **S3** | **No maximum batch size** on `GetPostsByIds` / `GetUsersByIds`. An unbounded `repeated string` is a trivial resource-exhaustion vector and an unpredictable latency source. |
| G5 | **S3** | **Timeline pagination contract is ambiguous.** §8.2.4 comments `cursor` as "post_id for keyset pagination" while §10.3 and the phase plan both use a millisecond timestamp. Two different cursor formats for the same field. |

### H. Operations, deployment, observability

| # | Sev | Finding |
|---|---|---|
| H1 | **S1** | **Observability, security hardening, and CI/CD are scheduled last (weeks 13–16).** This is backwards. You cannot debug a distributed fan-out without traces, and retrofitting OpenTelemetry across 8 services costs far more than building with it. Phases 3–6 would be developed and integrated with no metrics, no tracing, no CI, and no deployment pipeline. **Observability and CI are Phase 0 concerns.** |
| H2 | **S2** | **HPA on CPU/memory for I/O-bound Node.js services** (§13.3) is a weak signal — a Node process saturated on downstream latency shows low CPU. Worse, **Kafka consumer deployments must scale on consumer lag** (KEDA), not CPU, and cannot usefully scale beyond the partition count. Scaling on memory for a GC'd runtime is close to meaningless. |
| H3 | **S2** | **No graceful shutdown, PDB, or topology spread.** Missing: `terminationGracePeriodSeconds`, a `preStop` sleep to drain endpoints, SIGTERM handling that finishes in-flight Kafka messages before committing, `PodDisruptionBudget`, and `topologySpreadConstraints`. A node drain will drop in-flight requests and uncommitted messages. |
| H4 | **S2** | **`memory: 512Mi` limit with no `--max-old-space-size`.** Node's default heap target does not know about the cgroup limit; the process will be OOMKilled rather than GC'ing. Classic, and it always shows up in production first. |
| H5 | **S2** | **Deployment is `kubectl apply -k` from CI with no progressive delivery and no rollback.** No canary, no automated analysis, no defined rollback trigger. Combined with `image: social-app/post-service:latest` (§13.2) — a mutable tag that makes rollouts non-reproducible and rollbacks meaningless. |
| H6 | **S2** | **Alerts are static thresholds with no SLOs.** `rate(5xx) > 1%` for 5m will page at 3am for a blip and stay silent through a slow burn. Needs SLO definitions with error budgets and multi-window multi-burn-rate alerting, plus a runbook link on every alert. |
| H7 | **S3** | **`gRPC` liveness and readiness probes point at the same check.** Liveness must test only "is this process wedged"; readiness tests dependencies. Wiring liveness to a dependency check (§7 Phase, "readiness: DB, Redis, Kafka connected") means a Redis blip restarts every pod in the fleet simultaneously. |
| H8 | **S3** | **No environment strategy** — no dev/staging/prod parity statement, no ephemeral PR environments, no seed/fixture data plan. |

### I. Repository & engineering baseline

| # | Sev | Finding |
|---|---|---|
| I1 | **S1** | **TypeScript is not strict.** `tsconfig.json` sets `noImplicitAny: false` and `strictBindCallApply: false`, and never enables `strict`. For a system whose correctness argument rests on typed contracts across 8 services, this is the wrong default. Also missing: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. |
| I2 | **S1** | **There is no implementation.** `src/` is the unmodified `nest new` scaffold (`AppController` returning `"Hello World!"`). No monorepo layout, no `apps/`, no `libs/`, no Dockerfile, no `docker-compose.yml`, no `.env.example`, no CI workflow, no proto files. The 16-week plan starts from zero. |
| I3 | **S2** | **`test/app.e2e-spec.ts` is the scaffold test.** The plan's quality gate is "80%+ coverage", which is a vanity metric: it is satisfiable by tests that assert nothing, and it does not cover the actual risk surface here — proto/event schema compatibility, consumer idempotency, and fan-out correctness. |
| I4 | **S3** | **No `engines`, no `packageManager`, no `.nvmrc`, no `.editorconfig`.** The plan specifies pnpm and Node 20; nothing in the repo enforces either. |
| I5 | **S3** | **NestJS version drift in the docs.** §Appendix A and the plan summary say "NestJS 10"; `package.json` is on NestJS 11. |

---

## 4. What the v1 design gets right

Worth preserving explicitly, because the v2 design builds on it:

- **Service decomposition.** The seven-service split along data-ownership lines is correct, and the "Owns / Publishes / Consumes" table format in §6.2 is exactly the right way to express a service boundary.
- **Transactional outbox.** Correctly identified as the solution to the dual-write problem. The mechanism needs hardening (D3), not replacement.
- **Fan-out on write with a hybrid pull path for large accounts.** The right architecture. It just needs to be specified (B2).
- **Idempotent consumers with a dedupe table.** Right approach, wrong primary key (D1).
- **Keyset/cursor pagination as the default** for user-facing lists.
- **Partition-key rationale in §9.3.** The reasoning about ordering per aggregate is sound and correct.
- **The graceful-degradation narrative in §14.4** (circuit-break Redis, fall back to Postgres, set `X-Degraded-Mode`) is good instinct and the right shape.
- **The phase structure itself** — vertically sliced, demoable at each milestone — is a good delivery model. It mainly needs reordering (H1).

---

## 5. Required changes, ranked

The v2 design must resolve these in order. Everything else follows.

| Rank | Change | Resolves |
|---|---|---|
| 1 | Derive a **capacity model** from a stated design point; re-sizing everything from it. | A1, A2, E1 |
| 2 | Specify the **timeline read path** end-to-end: materialise/pull merge, cursor, filtering, hydration, rebuild-on-miss. | B1, B2, B3, E1, E3 |
| 3 | Fix the **event plumbing**: composite dedupe PK, schema registry + versioning, `SKIP LOCKED` outbox relay, retry topics + DLQ redrive. | D1–D5 |
| 4 | Introduce an explicit **authorization model** (visibility, blocking, ownership) enforced by the data-owning service. | F1, F6 |
| 5 | Rebuild the **token architecture**: identity service issues, JWKS verification, rotating refresh with reuse detection. | F2, F3 |
| 6 | Make **counters** single-sourced, idempotent, and reconcilable. | C1, C4, C5 |
| 7 | Adopt **UUIDv7**, partition `likes`, add partial indexes, add PgBouncer, define migration discipline. | C2, C3, C6–C8 |
| 8 | Split the **realtime gateway** out of the API gateway; replace pub/sub with a replayable stream. | B4, E5, F9 |
| 9 | Define **API conventions**: errors, pagination, idempotency, rate-limit headers, route disambiguation, batch caps. | G1–G5 |
| 10 | **Reorder the roadmap** so observability, CI/CD, and security baselines are Phase 0. | H1 |
| 11 | Add the **missing components**: email sender, jobs/maintenance, admin surface, moderation hooks. | B5, F4 |
| 12 | Fix the **engineering baseline**: strict TS, monorepo, Docker, CI, contract tests. | I1–I5 |

---

## 6. Next artefacts

| Document | Purpose |
|---|---|
| `docs/01-architecture/system-design.md` | v2.0 system design incorporating all of §5 |
| `docs/01-architecture/decisions.md` | ADRs recording each significant choice and its alternatives |
| `docs/02-components/*.md` | Per-component design, one per deployable |
| `docs/03-cross-cutting/*.md` | Security, data, observability, reliability, delivery, testing, API conventions |
| `docs/04-review/design-review-v2.md` | Review of the above, applied |
| `docs/05-roadmap/implementation-roadmap.md` | Reordered delivery plan with exit criteria |
