# Testing Strategy

v1's quality gate was "80%+ coverage" (review I3). Coverage is a vanity metric: it is satisfiable by tests that assert nothing, and it does not cover the actual risk surface here — contract compatibility, consumer idempotency, and fan-out correctness. This document replaces it with risk-targeted testing.

---

## 1. What can actually go wrong

Testing effort follows risk, not code volume.

| Risk | Likelihood | Impact | Where it is caught |
|---|---|---|---|
| Contract break between services | High | High | `buf breaking`, OpenAPI diff |
| Non-idempotent consumer | Medium | High | Integration replay tests |
| Timeline pagination duplicates/gaps | Medium | Medium | Integration pagination tests |
| Private/blocked content leak | Medium | **Critical** | Authorization matrix + search leak test |
| Transaction-pooling violation | High | Medium | Integration through PgBouncer |
| Index regression on the fan-out query | Medium | High | `EXPLAIN` assertions in CI |
| Migration incompatible with a rolling deploy | Medium | High | DDL lint + mixed-version test |
| Redis eviction breaking correctness | Low | High | Chaos + rebuild equivalence |
| Counter drift | Medium | Low | Replay tests + nightly reconciliation |

The four in bold-adjacent rows — authorization leaks, idempotency, index regressions, and pooling violations — are the ones that pass every unit test and fail in production.

---

## 2. The shape

```
        E2E (~20)              full journeys, main branch only
     Contract (auto)           buf breaking · OpenAPI diff · registry compat
   Integration (~250)          real Postgres/Redis/Kafka via Testcontainers
      Unit (~1200)             pure logic, no I/O, < 5 s total
```

Integration is weighted deliberately heavily. Most defects in this system live in the interaction between a service and its datastore — SQL that returns the wrong rows, a Lua script that is not cluster-safe, a consumer that double-applies — and none of those are reachable by a unit test with a mocked repository.

---

## 3. Unit tests

Pure functions, no I/O, no mocks of things we own beyond ports.

| Area | Examples |
|---|---|
| Validation | Grapheme-accurate length with emoji ZWJ sequences; username rules; URL rejection |
| Domain logic | Hashtag normalisation; mention extraction against adversarial input; thread-root derivation |
| Timeline | Merge/dedupe/sort; cursor round-trip; slack and the 3-pass cap |
| Trending | Score maths including the noise floor and a zero baseline |
| Authorization | **The full matrix** (§6) |
| Aggregation | Group keys, window boundaries, actor cap with the true count preserved |
| Token logic | Claims, expiry, reuse-detection state machine |

Rule: **no mocking of a database or a broker.** A test asserting that a service called `repository.save()` tests nothing about whether the SQL is correct. If a test needs a database, it is an integration test.

---

## 4. Integration tests

Real dependencies via Testcontainers (`libs/platform-testing`). Environment parity is the point:

| Dependency | Configuration | Why not simpler |
|---|---|---|
| Postgres | **Behind PgBouncer** | Transaction-pooling violations only fail under pooling (risk R5) |
| Redis | **Cluster mode** | Cross-slot errors do not reproduce standalone |
| Kafka | Redpanda, ≥3 partitions | Rebalancing and ordering need real partitions |
| Elasticsearch | Real | Mapping and analyzer behaviour is the thing under test |

Every simplification above would let a test pass on code that production rejects.

### The tests that matter most

**Consumer idempotency** — every handler:
```
process the same event 100× → assert the effect occurred exactly once
process an event, kill before offset commit, replay → same
```
This is the test that would have caught v1's single-column dedupe primary key (review D1): with four consumer groups on one topic, the second group's insert conflicts and the event is silently skipped.

**Timeline pagination**:
```
seed 400 posts → page fully at limit=20
  → assert: no duplicates, no gaps, 20 pages
insert posts concurrently mid-pagination
  → assert: still no duplicates, no gaps (new posts appear only on a fresh page 1)
```
Directly targets the score-collision bug in v1's millisecond cursor (review E3).

**Rebuild equivalence** — the invariant that makes eviction safe:
```
build a timeline by fan-out → snapshot page 1
DEL the key → read again (forces rebuild) → snapshot page 1
assert the two are equal
```
If this fails, Redis eviction silently changes what users see, and the entire "timelines are disposable" premise (ADR-0009) is unsound.

**Fan-out activity semantics**:
```
follower with an existing timeline key → receives the post
dormant follower with no key           → key is NOT created
```
Asserts the load-bearing trick in timeline-service §3.

**Privacy**:
```
author flips to private → within 60 s their posts are absent from the search index
blocked author's posts absent from the blocker's timeline within one read
private author's post → 404 (not 403) for a non-follower
```

**Query plans**:
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT follower_id FROM follows WHERE followee_id = $1 …
-- assert: Index Only Scan, no Seq Scan, no Sort
```
Asserted in CI against a seeded 1M-row table. A schema change that silently drops index-only-ness fails no functional test but degrades fan-out by two orders of magnitude (review C10, G3).

**Concurrency**:
```
1,000 concurrent likes on one post   → exactly 1,000 rows, exact final count
concurrent follow/unfollow           → converges to one state
two simultaneous identical POSTs with the same Idempotency-Key → one post, one 409
concurrent registration, same username → one succeeds, one 409
```

**Mixed-version migration**: run version N and N+1 of a service against one schema mid-migration and assert both work — the condition every rolling deploy actually creates.

---

## 5. Contract tests

Automated, not hand-written:

| Contract | Check | Failure mode prevented |
|---|---|---|
| gRPC protos | `buf breaking --against main` | A field renamed in one service, deserialised as absent in another |
| Event schemas | Registry `BACKWARD_TRANSITIVE` | A producer deploy breaking a consumer |
| REST API | OpenAPI diff vs committed spec | An undeclared breaking change reaching clients |
| DB schema | Migration DDL lint | An `ACCESS EXCLUSIVE` lock during a rolling deploy |

These run in ~10 seconds and prevent the class of failure that is hardest to detect in staging, because staging usually deploys everything together — which is precisely the condition production never has.

---

## 6. The authorization matrix

Table-driven, not example-by-example, so adding a state forces every combination to be re-decided rather than silently defaulting.

```
viewer ∈ {anonymous, self, follower, non-follower, blocked-by-author, blocking-author, moderator}
author ∈ {public-active, private-active, suspended, deactivated, erased}
post   ∈ {live, deleted}
```
7 × 5 × 2 = 70 cases, each asserting an expected `Decision`. Applied at every enforcement point: direct read, timeline hydration, search post-filter, notification render, thread read.

**This is the highest-value test suite in the system.** It is the one that would have caught v1's central privacy defect — `private_account` present in the schema and enforced nowhere (review F1).

---

## 7. E2E

Main branch only, against a preview environment, ~20 journeys:

register → verify → login → post → follow → timeline → like → notification (WebSocket) → search → block → private account → delete → erasure.

E2E tests are slow and flaky by nature, so they cover **breadth, not depth**: one path per feature, asserting the system is wired together. Depth belongs in integration tests.

---

## 8. Load and performance

k6 against staging at production scale, with **SLO assertions as pass/fail gates** — not a report a human reads:

| Scenario | Load | Gate |
|---|---|---|
| Timeline read | 1,000 RPS, 5% cold keys | p99 < 250 ms |
| Mixed traffic | 1,500 RPS at the design ratio | All SLOs hold |
| Post create | 50 RPS | p99 < 400 ms |
| Login | 50 RPS | p99 < 300 ms (argon2 is CPU-bound) |
| Fan-out burst | 100 large-ish accounts posting simultaneously | Freshness p99 < 5 s |
| Hot post | 500 likes/s on one post | No row-lock contention (validates delta batching) |
| Rebuild storm | Flush Redis at 500 RPS | No request > 2 s, DB connections bounded |
| WebSocket | 20,000 connections/instance | < 25 KB per connection |

The last two are the ones that validate design decisions rather than implementation: the rebuild storm tests the concurrency limiter (risk R2), and the hot-post test validates that counter delta batching actually removed the contention it was designed to remove.

Run weekly and before any release touching a hot path.

---

## 9. Chaos

Monthly game days in staging, listed in [`reliability.md`](./reliability.md) §8. The principle: **a degraded mode that has never been exercised is a hypothesis, not a design.**

---

## 10. Gates

| Gate | Requirement |
|---|---|
| Lint, format, typecheck | Pass |
| Unit tests | Pass |
| Integration tests | Pass |
| Contract checks | Pass |
| Coverage | ≥ 70% on `libs/`, ≥ 60% on `apps/` — **a floor, not a target** |
| Security scans | No high/critical |
| Migration lint | Pass |
| E2E (main) | Pass |
| Load (release) | SLO gates pass |

Coverage is stated as a floor to catch untested files, and explicitly not as a goal. A PR that raises coverage while adding no assertions is a regression in disguise; a PR that adds one integration test covering a replay scenario may move coverage barely at all and be the most valuable change that week.

---

## 11. Test data

- Deterministic seeds; fixed RNG; UUIDv7 and clock helpers for order-dependent assertions.
- The seed set includes the edge cases the design turns on: a large account above the fan-out threshold, a private account, a blocked pair, a deleted post with replies, a user following 0 accounts, a user following 5,000.
- Per-test isolation via template database, which resets in milliseconds rather than re-running migrations.
- **No production data in tests.**

A seed containing only ordinary users would let a fan-out threshold bug, a private-account leak, or an empty-follow-set rebuild loop reach production untested — each of which is a defect this design specifically introduces machinery to prevent.
