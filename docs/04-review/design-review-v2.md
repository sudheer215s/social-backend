# Design Review — v2.0 Document Set

**Reviewer role:** Senior engineer, reviewing the v2 architecture as an independent party
**Date:** 2026-07-31
**Scope:** `docs/01-architecture/`, `docs/02-components/`, `docs/03-cross-cutting/`

A design review that finds nothing has not happened. This pass treated the v2 documents the same way the v1 review treated the originals: trace each mechanism end to end, check the DDL would actually execute, check the numbers compose, and look for obligations named but not discharged.

**14 findings. 10 fixed in place; 4 accepted as known gaps with an owner and a trigger.**

---

## 1. Verdict

The v2 design closes every S1 from the v1 review. The mechanisms that carry the most weight — outbox with `SKIP LOCKED`, composite dedupe keys, UUIDv7 as both index key and cursor, rebuildable timelines, fail-closed blocks — are internally consistent and each is justified against a stated alternative.

The defects found here fall into three groups, and the distribution is itself informative:

- **Two invalid SQL statements** (V1, V2). Both were plausible-looking DDL that Postgres rejects outright. Design documents are not compiled, so this class of error survives review unless someone reads the SQL as SQL.
- **Three unbounded or mis-costed paths** (V3, V4, V5) — cases where an operation described as cheap is linear or quadratic at production scale.
- **Four gaps between documents** (V6–V9) where two docs described the same thing differently, or one made a claim another contradicted.

The remaining findings are scope gaps that were always intended to be deferred but had not been stated as such.

---

## 2. Findings

### V1 — `processed_events` primary key is invalid under partitioning · **S1 · FIXED**

**Where:** `system-design.md` §9.3

```sql
CREATE TABLE processed_events (
  consumer_group text, event_id uuid, processed_at timestamptz,
  PRIMARY KEY (consumer_group, event_id)
) PARTITION BY RANGE (processed_at);
```

Postgres requires the partition key to be included in every unique constraint. This statement fails with `unique constraint on partitioned table must include all partitioning columns`. The table that the entire effectively-once guarantee rests on would not have been creatable.

Ironic, given the v1 review's headline event-plumbing finding (D1) was also this table's primary key.

**Fix applied.** PK is `(consumer_group, event_id, processed_at)`, with an explicit note on the weakened uniqueness — the constraint no longer prevents the same `(group, event_id)` on different days. That is safe only because `processed_events` retention is set equal to Kafka topic retention, so a redelivery always lands inside the same window. That coupling is now written down rather than implied.

---

### V2 — Aggregation index uses `now()` in a predicate · **S1 · FIXED**

**Where:** `notification-service.md` §2, §4

```sql
CREATE UNIQUE INDEX uq_notif_group ON notifications (user_id, group_key, created_at)
  WHERE created_at > now() - interval '1 hour';
```

Index predicates must be `IMMUTABLE`. `now()` is `STABLE`. Postgres rejects this with `functions in index predicate must be marked IMMUTABLE`. The `ON CONFLICT` clause referencing the same predicate would also have been invalid.

The aggregation design — the thing that turns 50 likes into one notification — depended on a constraint that cannot exist.

**Fix applied.** Added a stored `group_window bigint` column (`floor(epoch_ms / window_ms)`), with the unique index on `(user_id, group_key, group_window, created_at)`.

The fix changes behaviour, and the doc now says so: windows become **fixed buckets rather than sliding**, so two likes five minutes apart can straddle a boundary and produce two notifications. That is the cost of an atomic index-enforced constraint; a true sliding window requires read-then-write and reintroduces exactly the race that made aggregation hard in v1.

---

### V3 — `GetPostsByIds` cannot prune partitions · **S1 · FIXED**

**Where:** `post-service.md` §2, §5

`posts` is `PARTITION BY RANGE (created_at)`, so its PK is `(id, created_at)`. But `GetPostsByIds` looks up by `id` alone — which means scanning **every** partition. Timeline hydration is the hottest query in the system, and its cost would have grown linearly with every month of retained history. Nothing would fail; it would just get slower forever, which is the worst kind of defect.

**Fix applied.** The `created_at` is reconstructed from the UUIDv7 prefix in the application, and the lookup becomes `WHERE (id, created_at) IN ((:id1, :ts1), …)`, which prunes to the one or two partitions a page spans.

This turned out to be a third payoff of ADR-0003 that the ADR had not claimed: the same property that makes UUIDv7 a valid cursor makes it partition-routable. Worth noting as a genuine argument for the choice, not just a convenience.

---

### V4 — Timeline rebuild query is unbounded per author · **S2 · FIXED**

**Where:** `timeline-service.md` §5, `post-service.md` §5

```sql
SELECT id FROM posts WHERE author_id = ANY($1) … ORDER BY id DESC LIMIT 400
```

With 1,000 authors, `LIMIT 400` applies *after* the sort, so Postgres must produce every qualifying row for all 1,000 authors before it can discard them. For a user following a thousand active accounts this is tens of thousands of rows to return four hundred — and it sits behind a 200-concurrency limiter that a Redis failover saturates.

The claimed p99 of 150 ms was not defensible for this query shape.

**Fix applied.** Rewritten as `CROSS JOIN LATERAL` with an inner `LIMIT 20` per author, so each of the 1,000 index-only scans terminates after 20 rows. Work is bounded at 1,000 × 20 regardless of how prolific the authors are.

The per-author cap also improves the *result*: one hyperactive account can no longer monopolise a rebuilt timeline. A correctness improvement fell out of a performance fix, which usually means the original shape was wrong for more than one reason.

---

### V5 — No path for pagination past the materialised window · **S2 · FIXED**

**Where:** `timeline-service.md` §4

Timelines hold 400 entries. `timeline-service.md` §2 claimed "reads beyond it fall through to the rebuild path" — but rebuild triggers on a **missing key**, not an exhausted range. A user scrolling past entry 400 would hit the end of the sorted set and receive `has_more: false` while older posts plainly existed.

The timeline would silently end at ~2–3 days of history with no error, no metric, and no way for a user to tell it from having reached the actual end of their feed.

**Fix applied.** Added §4a **Deep page** as an explicit branch: on exhaustion, query post-service directly over the (bounded) following set, using the same LATERAL form and the same 200-concurrency semaphore. Deep pages are deliberately **not** written back into the sorted set — doing so would evict the fresh head that every other read depends on.

This is fan-out-on-read applied exactly where it is cheapest: the deeper the scroll, the fewer the readers. It also makes the hybrid story complete — the design now has three read paths (materialised, pull, deep) rather than two and a gap.

---

### V6 — Self fan-out contradicted the activity invariant · **S2 · FIXED**

**Where:** `timeline-service.md` §3

Step 4 wrote to the author's own timeline **unconditionally**, while §3's central claim is that `tl:h:{uid}` exists *exactly* when its owner read their timeline in the last 14 days. A write-only client — a bot, a scheduled integration, a cross-poster — would accumulate a materialised timeline it never reads, and the "key existence is the activity signal" invariant would be quietly false.

Small in effect, but it undermines the load-bearing trick of the whole fan-out design. An invariant with an exception is not an invariant.

**Fix applied.** Self fan-out uses the same conditional script. An author who returns to read gets a rebuild that includes their own posts anyway, so nothing is lost.

---

### V7 — Relationship cache location was unspecified, defeating block invalidation · **S1 · FIXED**

**Where:** `graph-service.md` §5, `timeline-service.md` §4

`GetRelationshipContext` is described as "cached 30 s", and block writes "force-invalidate the cache synchronously". Those two statements are only compatible if the cache is in Redis. Nothing said so — and an in-process cache is the obvious implementation of "cached 30 s" for a value read on every timeline request.

A process-local copy would survive the Redis `DEL`, on an unbounded number of replicas, with no way to reach it. **Blocks would leak for up to 30 seconds after the user blocked someone** — the exact failure ADR-0015 exists to prevent, reintroduced by an unstated implementation detail.

This is the most likely of these findings to have actually shipped, because the wrong implementation is the more natural one.

**Fix applied.** `graph-service.md` §5 now states that relationship caches are Redis-only, never process-local, and says why.

---

### V8 — API availability SLO contradicted the composition arithmetic · **S2 · FIXED**

**Where:** `observability-and-slo.md` §1 vs `reliability.md` §1

SLO 1 commits to 99.9% API availability. `reliability.md` then computes effective read availability at ~99.7% from three critical components at 99.9% each. Two documents, two numbers, no reconciliation — and the design would have been "missing its SLO" by its own arithmetic on day one.

**Fix applied.** `reliability.md` now states the tension directly: 99.9% is achievable only if the three critical components each exceed 99.9%, which is precisely why Postgres is managed with HA (targeting 99.95%) and the two services are multi-replica, multi-zone, and shed load rather than fail.

Keeping the pessimistic bound visible is more useful than quietly deleting it — it says that if the API SLO is being missed, the cause is in one of three places, not eight.

---

### V9 — Idempotency storage specified in two places, two ways · **S3 · FIXED**

`system-design.md` §8.3 listed `idempotency_keys` as a per-service Postgres table (inherited from v1 §14.5); `api-gateway.md` §5 specified Redis with a 24-hour TTL and an in-flight marker. The gateway owns no database, so the table could not have been where it said.

**Fix applied.** Redis is authoritative; the table is removed with the trade recorded — losing keys to a Redis outage risks a duplicate post on a retry that spans it, and paying a synchronous Postgres write on every mutating request to close that window is the wrong trade.

---

### V10 — Search pagination violated the project's own convention · **S3 · FIXED**

`api-conventions.md` §3 mandates opaque cursors and forbids offset pagination everywhere. `search-service.md` §4 then specified `from`/`size` capped at 1,000, with `search_after` mentioned only as an option for "deeper paging".

Beyond the inconsistency, deep `from` paging makes every shard collect and sort `from + size` hits, and produces the same skip/duplicate behaviour under concurrent indexing that offset pagination produces in SQL — the exact defect the convention exists to prevent.

**Fix applied.** Search uses `search_after` exclusively, encoded as the standard opaque cursor.

---

### V11 — Redis notification-stream estimate confused a cap with a fill level · **S3 · FIXED**

`system-design.md` §3.3 sized notification streams at 200K users × 200 entries × 250 B ≈ 10 GB, making them the second-largest Redis consumer and the basis of risk R3.

`MAXLEN ~ 200` is a **cap**, not a fill level, and entries carry only an ID, type, and timestamp (~120 B with overhead, not 250 B). The median user does not accumulate 200 unread notifications. The estimate was roughly 10× the expected value, which inflated the total budget and made R3 look more urgent than it is.

**Fix applied.** Both figures are now given — ~1 GB expected, 10 GB as an arithmetic bound — with the note that provisioning uses the bound and forecasting uses the expectation. Total revised to ~9 GB expected / ~18 GB worst case.

Over-estimating capacity is safer than under-estimating it, but not free: it distorts the risk register and buys hardware for a scenario that will not occur.

---

## 3. Accepted gaps

Not defects — scope decisions that were implicit and are now explicit, each with a trigger.

### V12 — No email-sender component · **Phase 1**

`architecture-review-v1.md` B5 identified a missing email sender; `identity-service.md` depends on one for verification and password reset; `notification-service.md` §10 mentions a digest sender. No component document exists.

**Accepted.** The interface is narrow and well-defined (consume `social.notification.v1` and identity's transactional email requests; provider behind an internal port per open question Q5). It needs a component doc before Phase 1 delivery, not before the architecture is approved. Deliberately kept thin so the provider choice stays reversible.

### V13 — No `jobs` component document · **Phase 2**

`system-design.md` §5.3 lists nine scheduled jobs and the repo layout includes `apps/jobs`. There is no design covering leader election, overlap prevention, failure alerting, or idempotency for jobs that mutate data — and `counter-reconcile` and `erasure-worker` both mutate data in ways that must not double-apply.

**Accepted for Phase 2**, when the first data-mutating job ships. `partition-maintenance` and `outbox-vacuum` are safe to run without it; `counter-reconcile` and `erasure-worker` are not.

### V14 — No admin/moderation surface · **Post-v2**

`security.md` §3 defines `moderator` and `admin` roles and says operations run through "an audited CLI". No design exists for that CLI, for the moderation queue, or for the report-handling workflow. `system-design.md` §2 lists automated moderation as a non-goal, but *manual* moderation is not optional for a public social product.

**Accepted with a caveat that should be read as a launch blocker rather than a nice-to-have.** The enforcement primitives exist and are the hard part — `users.status = 'suspended'` makes every piece of a user's content fail `canView` instantly, with no fan-out and no backfill (system design §11.4). What is missing is the operator interface, which is a small amount of work on top of a correct model. It must exist before public launch.

---

## 4. Traceability — v1 findings

Every S1 and S2 from `architecture-review-v1.md`:

| v1 finding | Resolution |
|---|---|
| A1, A2 Sizing not derived | Capacity model, system design §3; targets restated as 1,500 RPS peak with the v1 inconsistency explained |
| A3 No error budget / DR | SLOs + error-budget policy; RPO 5 min / RTO 1 h with monthly restore rehearsal |
| A4 No data lifecycle | Staged erasure §8.6; retention table; PII kept out of Kafka by design |
| B1 Timeline not durable | Derived, evictable, rebuildable; rebuild is a primary path with a limiter and chaos test |
| B2 Hybrid read path undefined | §10.5 specified end to end; three read paths after V5 |
| B3 Timeline delete infeasible | Tombstone-at-hydration, lazy `ZREM`, one mechanism for four cases |
| B4 WebSocket in the gateway | Separate `realtime-gateway` (ADR-0011) |
| B5 Missing components | Email sender (V12), jobs (V13), admin (V14) — now explicit with triggers |
| C1 Counter contradiction | Event-only, idempotent, delta-batched, nightly reconciled |
| C2 `likes` unpartitioned | Hash-partitioned ×32 |
| C3 UUIDv4 PKs | UUIDv7 (ADR-0003) — index locality, cursors, and partition pruning |
| C4 Hot-row contention | 1-second delta batching |
| C5 Counter clamping | `CHECK (>= 0)`, no clamp |
| C6 Missing partial indexes | All indexes `WHERE deleted_at IS NULL` |
| C7 Connection budget | PgBouncer mandatory, pool capped in the config schema, tests run through it |
| C8 No migration strategy | Expand/contract, lock classes, CI DDL lint, mixed-version test |
| D1 Dedupe PK | Composite — and corrected again in V1 for partitioning |
| D2 No schema registry | Protobuf + registry, `BACKWARD_TRANSITIVE` in CI |
| D3 Outbox concurrency | `FOR UPDATE SKIP LOCKED`, explicit partition key, UUIDv7 ordering |
| D4 "Exactly-once" misnomer | Renamed; the requirement it implies is stated everywhere |
| D5 No retry topics | Non-blocking ladder + DLQ + redrive tooling and runbook |
| D6 Cross-topic ordering | Handlers tolerate out-of-order and missing referents |
| E1 Redis unbounded | 400 entries, active-only, TTL, evictable — ~7 GB vs ~140 GB |
| E2 Stale follower cache | Fan-out reads the source of truth |
| E3 Cursor collisions | Total order via UUIDv7 lex ordering |
| E4 Token in Redis key | Keyed on `sha256(token)` |
| F1 **Private accounts unenforced** | Authorization model §11; `platform-authz`; 70-case matrix; search leak test |
| F2 JWT gaps | EdDSA, `kid`, JWKS, rotation, rotating refresh with reuse detection |
| F3 Split token authority | identity-service issues; gateway verifies |
| F4 Password reset undesigned | Fully specified, anti-enumeration, all sessions revoked |
| F5 Orphaned idempotency | Required on all post-creating endpoints; `PUT` for state assertions |
| F6 No blocking/muting | Designed in graph-service; enforced across timeline, search, notification |
| F7 Committed secrets | External Secrets Operator; no prod secrets in CI |
| F8 Manual mTLS rotation | Service mesh, 24-hour identity rotation |
| G1 Route collision | `/v1/users/by-username/{username}` |
| G2 No API conventions | `api-conventions.md` |
| G3 Offset fan-out pagination | Keyset with a composite cursor; `EXPLAIN` asserted in CI |
| H1 **Observability last** | Phase 0 (ADR-0012, roadmap) |
| H2 CPU-scaled consumers | KEDA on lag, capped at partition count |
| H3 No graceful shutdown | `preStop`, grace periods, drain, PDB, topology spread |
| H4 Node OOM | `--max-old-space-size` below every container limit |
| H5 `:latest`, no canary | Digest pinning, Argo Rollouts with automated analysis |
| H6 Static alerts | Multi-window burn-rate alerting; runbook required per alert |
| I1 TypeScript not strict | `strict` + `noUncheckedIndexedAccess` (ADR-0001) |
| I3 Coverage as a gate | Risk-targeted strategy; coverage is a floor, explicitly not a target |

All S1 and S2 items closed or explicitly deferred with a trigger.

---

## 5. Residual risks

Unchanged from `system-design.md` §13, with the review's view:

| Risk | Assessment |
|---|---|
| R2 Rebuild storm | **The one to watch.** V4 and V5 both made this path busier — deep pages now share the same semaphore. The 200 limit is a guess until the chaos test runs; expect to tune it. |
| R7 Eight services is heavy | Still the biggest strategic risk. The design keeps collapse-to-fewer-processes available; take it if the team is smaller than the topology assumes. |
| R3 Notification stream memory | Downgraded by V11 — ~1 GB expected, not 10 GB. |
| R4 Elasticsearch ownership | Unchanged. Search failing non-fatally is the mitigation that matters. |
| R5 PgBouncer constraints | Adequately mitigated by testing through PgBouncer. |
| R6 Counter drift normalised | Adequately mitigated by treating drift as an SLI with a budget. |

---

## 6. Recommendation

**Approved for implementation.**

The fixes in §2 are applied. V12–V14 are tracked against the phases in `docs/05-roadmap/`. The three items that most need validation by running code rather than review:

1. **The rebuild limiter (R2)** — chaos-test in Phase 4, before the timeline design is trusted.
2. **The 50,000-follower threshold** — derived arithmetically, never measured. Expect to move it.
3. **Fixed-bucket aggregation (V2)** — the boundary artefact is theoretically minor and should be confirmed against real notification patterns.

A design document's job is to be wrong in ways that are cheap to fix. Fourteen findings at review time, two of which would not have compiled, is a reasonable yield — and considerably cheaper than finding them in Phase 5.
