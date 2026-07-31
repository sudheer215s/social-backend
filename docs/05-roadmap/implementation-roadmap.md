# Implementation Roadmap

**Supersedes:** `implementation-plan-8-phases.md`

The v1 plan was well-structured — vertically sliced, demoable at each milestone — and wrong in its ordering. It scheduled observability, security hardening, and CI/CD for weeks 13–16, *after* every asynchronous path had been built (review H1). Phases 3–6 would have been developed and integrated with no traces, no metrics, no CI, and no deployment pipeline.

This plan keeps the slicing and fixes the ordering.

---

## 1. What changed

| Change | Why |
|---|---|
| **Phase 0 added** (2 weeks): monorepo, CI/CD, observability, platform libraries | You cannot debug distributed fan-out without traces; retrofitting OTel across 8 services costs several times building with it |
| **Security moved into every phase** | Authorization is a data-model concern. Retrofitting `canView` after fan-out and search exist means revisiting both |
| **Reliability patterns move to Phase 1** | Deadlines, retries, breakers, shutdown belong in `platform-grpc` before there are eight callers of it |
| **Deployment moves to Phase 0** | Every phase after it deploys to a real cluster and gets real signal |
| **Timeline split into two phases** | It is the hardest component; fan-out and the read path are separately riskable |
| **Load and chaos gates added per phase** | A phase is done when it holds under load, not when it passes unit tests |
| 20 weeks → **22 weeks** | Phase 0 is new; the rest is redistributed, not extended |

**Rule: no phase ships without its observability, tests, and runbooks.** Those are not a phase; they are part of the definition of done.

---

## 2. Overview

| Phase | Weeks | Delivers | Gate |
|---|---|---|---|
| 0 | 1–2 | Platform: repo, CI/CD, OTel, deploy pipeline | A "hello" service traced end-to-end in staging |
| 1 | 3–5 | Identity: auth, profiles, tokens | Register → login → refresh → revoke, load-tested |
| 2 | 6–8 | Content + graph: posts, likes, follows, blocks | Full authorization matrix passes |
| 3 | 9–10 | Event backbone: outbox, consumers, retry/DLQ | Replay and poison-message tests pass |
| 4 | 11–13 | Timeline: fan-out + read path | Freshness SLO holds; rebuild storm survives chaos |
| 5 | 14–15 | Notifications + realtime | Delivery SLO holds at 20K connections |
| 6 | 16–17 | Search + trending | No private-content leak; index freshness holds |
| 7 | 18–19 | Hardening: abuse, erasure, moderation, DR | Restore rehearsal + game day pass |
| 8 | 20–22 | Scale validation and launch readiness | 1,500 RPS with all SLOs green |

---

## Phase 0 — Platform foundation · Weeks 1–2

Everything after this depends on it. Nothing here is user-visible, and skipping it is the most expensive decision available.

**Repo:** pnpm workspaces, Nest `apps/`+`libs/`, Turborepo, **TypeScript `strict` + `noUncheckedIndexedAccess`**, ESLint with boundary rules, Prettier, commit hooks, `.nvmrc`, `engines`.

**Platform libraries:** `platform-config` (fail-fast validation), `platform-telemetry` (OTel, Pino, health), `platform-db` (Drizzle, PgBouncer-safe pool, migrator), `platform-grpc` (deadline, retry budget, breaker), `platform-testing` (Testcontainers).

**Local stack:** Compose with Postgres + **PgBouncer** + Redis **cluster** + Redpanda + Elasticsearch + OTel/Grafana/Tempo/Loki. Production topology, not a simplified one — the failure modes that matter do not reproduce on simplified infrastructure.

**CI/CD:** the full pipeline from `deployment-and-cicd.md` — lint/typecheck/test/build/scan/sign, Argo CD, Argo Rollouts, preview environments.

**Cluster:** namespaces, Linkerd, cert-manager, External Secrets, observability stack, managed Postgres.

**Exit criteria**
- [ ] A trivial service deploys through the full pipeline to staging
- [ ] A request produces a trace spanning gateway → service → Postgres → Redis
- [ ] Metrics scraped, dashboard live, one alert fires correctly in a test
- [ ] Preview environment created and destroyed by a PR
- [ ] `pnpm dev` works from a clean clone in under 10 minutes
- [ ] Canary rollout aborts automatically on an injected error rate

> The last item matters more than it looks. A canary that has never aborted is a slower deploy, not a safer one.

---

## Phase 1 — Identity and the edge · Weeks 3–5

**Delivers:** `identity-service`, `api-gateway`, and the email sender (gap V12).

Week 3 — schema (`users`, `credentials`, `sessions`, `user_settings`, `email_tokens`), registration and login with argon2id, anti-enumeration.
Week 4 — EdDSA tokens, JWKS with rotation, **rotating refresh with reuse detection**, revocation; email verification and password reset with the provider behind an internal port.
Week 5 — gateway: JWT verification, rate limiting, idempotency, RFC 9457 errors, OpenAPI; profile CRUD and caching.

**Exit criteria**
- [ ] Register → verify → login → refresh → revoke, end to end
- [ ] **Token reuse revokes the family** (the control v1 lacked entirely)
- [ ] JWKS rotation with in-flight tokens causes zero auth failures
- [ ] Login timing is indistinguishable between unknown-email and wrong-password
- [ ] Login load-tested at 50 RPS (argon2id is CPU-bound — the one endpoint here that is)
- [ ] Rate limits enforced; fail-open on Redis loss is observable
- [ ] No PII in logs (asserted by test)

---

## Phase 2 — Content and graph · Weeks 6–8

**Delivers:** `post-service`, `graph-service`, `platform-authz`.

Week 6 — posts partitioned monthly, `likes` hash-partitioned ×32, partial indexes, grapheme-accurate validation, hashtag/mention extraction; create/read/delete with ownership in the predicate.
Week 7 — follows with both covering indexes and **keyset** enumeration; blocks with synchronous cache invalidation; mutes; follow requests for private accounts.
Week 8 — `platform-authz` and the **70-case authorization matrix**; likes and reposts with `ON CONFLICT DO NOTHING`; gateway composition.

**Exit criteria**
- [ ] **Authorization matrix passes at every enforcement point** — the suite that closes v1's central privacy defect
- [ ] Private post returns 404 (not 403) to a non-follower
- [ ] Block severs follows both ways and invalidates cache before returning
- [ ] `EXPLAIN` asserts index-only scans on both enumeration queries, against 1M seeded rows
- [ ] Keyset pagination over 1M followers: no duplicates, no gaps
- [ ] 1,000 concurrent likes on one post → exactly 1,000 rows
- [ ] Migrations verified against a mixed-version rolling deploy

---

## Phase 3 — Event backbone · Weeks 9–10

**Delivers:** `platform-events` and the outbox relays. No user-visible feature — this is the phase that makes phases 4–6 trustworthy.

Week 9 — Protobuf envelope, schema registry, `buf breaking` in CI; outbox table and `SKIP LOCKED` relay; producers wired into post, graph, identity.
Week 10 — consumer runtime (dedupe, transaction, manual commit, tracing), retry ladder, DLQ + `dlq-inspect`; counter consumers with delta batching; `counter-reconcile`.

**Exit criteria**
- [ ] Entity and event commit atomically — verified by killing the process mid-transaction
- [ ] **Replaying an event 100× produces one effect**, for every handler
- [ ] Poison message reaches the DLQ without blocking its partition
- [ ] Retry ladder observed advancing through all three tiers
- [ ] `buf breaking` blocks an incompatible schema change
- [ ] Counter drift < 0.1% after a replay of a full day of events
- [ ] Trace continuity across Kafka verified by test
- [ ] Outbox depth and lag dashboards live with alerts

---

## Phase 4 — Timeline · Weeks 11–13

The hardest component, and the one v1 specified least. Three weeks, deliberately.

Week 11 — Redis ZSET representation, base64url UUIDv7 members, `fanout.lua` with XX semantics, keyset follower paging, self-trimming.
Week 12 — read path: materialised + pull merge, cursor, filtering, hydration, tombstones; large-account registry with hysteresis; **rebuild with the 200-concurrency limiter**; **deep-page branch** (review V5).
Week 13 — degraded modes including lag compensation; chaos and load.

**Exit criteria**
- [ ] Fan-out writes only to existing keys (dormant follower's key is *not* created)
- [ ] **Rebuild produces the same page 1 as fan-out** — the invariant that makes eviction safe
- [ ] Full pagination through 400 entries: no duplicates, no gaps, stable under concurrent inserts
- [ ] Deep pagination past 400 returns older posts correctly
- [ ] Deleted/blocked/private/suspended authors all filtered by the one hydration mechanism
- [ ] Freshness p99 < 5 s at design-point load
- [ ] **Rebuild storm: flush Redis at 500 RPS — no request > 2 s, DB connections bounded** (risk R2)
- [ ] Timeline read p99 < 250 ms at 1,000 RPS with 5% cold keys
- [ ] Redis memory within budget with 200K materialised timelines

> The rebuild-storm test is the one that decides whether ADR-0009 was a good idea. Run it before building on top of the timeline.

---

## Phase 5 — Notifications and realtime · Weeks 14–15

Week 14 — `notification-service`: schema with `group_window`, event handlers with preference and relationship filters, fixed-bucket aggregation, read API, Redis unread counts.
Week 15 — `realtime-gateway`: ticket auth, connection registry, Redis Streams delivery with batched hydration, catch-up, limits, staggered draining.

**Exit criteria**
- [ ] 50 concurrent likes → one notification, `actor_count = 50`, 8 stored actors
- [ ] Suppressed events still record dedupe (replay after a preference change stays suppressed)
- [ ] Delivery p99 < 3 s to a connected client
- [ ] Disconnect 30 s → reconnect replays exactly the missed set
- [ ] 20,000 connections on one instance at < 25 KB each
- [ ] Instance kill → clients reconnect within 30 s, nothing lost, no thundering herd
- [ ] Redis loss → clients fall back to polling, no notifications lost

---

## Phase 6 — Search and trending · Weeks 16–17

Week 16 — indices with `dynamic: strict` behind aliases, bulk indexer, queries with pre-filter and post-filter, `search_after` cursors.
Week 17 — Redis time-bucketed trending; alias-swap reindex with Kafka gap-fill; nightly reconciliation.

**Exit criteria**
- [ ] **Private-account flip removes their posts from the index within 60 s** — the highest-risk test in this phase
- [ ] Blocked authors post-filtered; the filter fails closed when graph is down
- [ ] Index freshness p99 < 30 s
- [ ] Golden relevance set passes in CI
- [ ] Alias-swap reindex drops no queries
- [ ] ES down → empty results with `degraded: true`, **never a 5xx**
- [ ] Full rebuild from Postgres rehearsed and timed

---

## Phase 7 — Hardening · Weeks 18–19

Closes the remaining review gaps and everything that is easy to defer forever.

Week 18 — abuse controls (velocity, duplicate detection, follow-churn heuristics); staged deletion and `erasure-worker`; data export; the `jobs` app with leader election and overlap prevention (gap V13).
Week 19 — moderation CLI with audit logging and suspension (gap V14); backup/restore rehearsal; game day; runbooks; penetration test.

**Exit criteria**
- [ ] Erasure completes across Postgres, Elasticsearch, and Kafka tombstones
- [ ] Suspension takes effect everywhere immediately (one flag, no backfill)
- [ ] **Restore from backup meets RTO 1 h / RPO 5 min — rehearsed, not asserted**
- [ ] Game day: Redis, Kafka, Postgres, and graph-service failures all behave as documented
- [ ] Every paging alert has a runbook, and each has been exercised
- [ ] Penetration test findings triaged and closed
- [ ] All jobs idempotent and safe to run concurrently

---

## Phase 8 — Scale validation and launch · Weeks 20–22

Week 20 — full-scale load: 1,500 RPS mixed, fan-out bursts, hot-post likes, rebuild storms, 20K WebSocket connections. Tune from evidence.
Week 21 — capacity review against the model; **revisit the 50,000-follower threshold with real data**; cost review; scale-out triggers documented.
Week 22 — documentation reconciled with reality, on-call rotation, launch checklist, soak test.

**Exit criteria**
- [ ] All seven SLOs green under sustained design-point load
- [ ] 72-hour soak with no leaks and no unbounded growth
- [ ] Cost within budget; per-service attribution available
- [ ] Every documented degraded mode demonstrated under load
- [ ] Docs updated where load testing contradicted the design
- [ ] On-call rotation staffed, runbooks rehearsed

---

## 3. Cross-phase, every phase

- **Observability:** dashboard, SLIs, alerts + runbooks before the phase closes.
- **Security:** authorization tests for every new surface; threat-model review for every new component.
- **Testing:** unit + integration (real dependencies) + contract; load for anything on a hot path.
- **Docs:** the component doc updated to match what was built, not what was planned.
- **ADRs:** any decision that diverges from `decisions.md` is recorded there.

---

## 4. Sequencing constraints

```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5
                   └──► 6
      2 ──────────────► 7 ──► 8
```

| Constraint | Why |
|---|---|
| 3 before 4, 5, 6 | All three are event consumers; building them on ad-hoc Kafka code means rewriting all three |
| 2 before 4 | Fan-out needs follows; the read path needs blocks |
| 4 before 5 | Notification aggregation reuses timeline patterns and the same Redis discipline |
| 5 and 6 parallel | Independent consumers; only overlap is authorization, done in 2 |
| 7 after 2 | Erasure and moderation need the full data model |

Phases 5 and 6 can run in parallel with a second team. Nothing else can be usefully parallelised — the dependencies are real, not scheduling artefacts.

---

## 5. Risks to the plan

| Risk | Mitigation |
|---|---|
| Phase 0 is invisible and feels like delay | It is two weeks. Retrofitting it across eight services is two months. Skipping it is the single most expensive available decision |
| Phase 4 overruns | Three weeks allocated and split into fan-out / read / hardening. If it overruns, ship reverse-chronological pull-only and add fan-out after — the read path already merges two sources |
| Eight services outpace the team (risk R7) | Reassess after Phase 3. Collapsing the gRPC services into one process is a composition change, not a rewrite |
| Load testing invalidates design assumptions | Expected. That is why Phase 8 has a tuning week and why the 50K threshold is called out as a guess |
| Scope creep from deferred items | The non-goals table and open questions are the contract. Changes go through an ADR |

---

## 6. First week

1. Enable TypeScript `strict` and fix the fallout (small now, large later).
2. Convert to a pnpm workspace with `apps/`+`libs/`.
3. `platform-config` and `platform-telemetry` — telemetry first, so nothing is built without it.
4. Compose stack with production topology.
5. CI pipeline through to a container image.
6. Cluster bootstrap: Argo CD, observability, managed Postgres.
7. Deploy a trivial service end-to-end and **verify a trace crosses a process boundary**.

Item 7 is the Phase 0 acceptance test in miniature. Until a trace crosses a boundary, none of the phases that follow are debuggable.
