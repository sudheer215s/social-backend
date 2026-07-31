# Architecture Documentation

Design documentation for the social backend. Written as a review-then-redesign pass over the original v1 planning documents, which remain in the repo root for reference.

---

## Reading order

**New to the project — read these three, in order:**

1. [`01-architecture/system-design.md`](./01-architecture/system-design.md) — the whole system: capacity model, components, consistency model, core flows, the timeline algorithm, authorization
2. [`01-architecture/decisions.md`](./01-architecture/decisions.md) — 16 ADRs: what was chosen, what was rejected, and what would make us revisit
3. The component doc for whatever you are working on

**Reviewing the architecture — start with the reviews:**

1. [`00-review/architecture-review-v1.md`](./00-review/architecture-review-v1.md) — what was wrong with v1 and why (45 findings)
2. [`04-review/design-review-v2.md`](./04-review/design-review-v2.md) — what was wrong with v2 and how it was fixed (14 findings)

**Implementing — start with the roadmap:**

[`05-roadmap/implementation-roadmap.md`](./05-roadmap/implementation-roadmap.md)

---

## Contents

### `00-review/` — Review of the original design
| Document | |
|---|---|
| [`architecture-review-v1.md`](./00-review/architecture-review-v1.md) | 45 findings across sizing, architecture, data, events, caching, security, API, ops, and repo state |

### `01-architecture/` — The system
| Document | |
|---|---|
| [`system-design.md`](./01-architecture/system-design.md) | v2.0. Capacity model, architecture, consistency model, flows, data and event architecture, the timeline algorithm, authorization, scale-out path, risks |
| [`decisions.md`](./01-architecture/decisions.md) | ADR-0001 … ADR-0016 |

### `02-components/` — One per deployable
| Document | Kind |
|---|---|
| [`api-gateway.md`](./02-components/api-gateway.md) | HTTP · BFF · rate limiting · idempotency |
| [`realtime-gateway.md`](./02-components/realtime-gateway.md) | WebSocket · Redis Streams delivery |
| [`identity-service.md`](./02-components/identity-service.md) | Users, credentials, sessions, tokens |
| [`post-service.md`](./02-components/post-service.md) | Posts, likes, replies, hashtags, mentions |
| [`graph-service.md`](./02-components/graph-service.md) | Follows, blocks, mutes, fan-out enumeration |
| [`timeline-service.md`](./02-components/timeline-service.md) | Fan-out, merge, rebuild — the core algorithm |
| [`notification-service.md`](./02-components/notification-service.md) | Creation, aggregation, delivery |
| [`search-service.md`](./02-components/search-service.md) | Indexing, query, trending |
| [`platform-libraries.md`](./02-components/platform-libraries.md) | Shared `libs/*` — where correctness is made cheap |

### `03-cross-cutting/` — Concerns that span components
| Document | |
|---|---|
| [`api-conventions.md`](./03-cross-cutting/api-conventions.md) | Versioning, errors (RFC 9457), pagination, idempotency, headers |
| [`security.md`](./03-cross-cutting/security.md) | Threat model, authn, authz, transport, secrets, abuse, privacy |
| [`data-management.md`](./03-cross-cutting/data-management.md) | Conventions, migrations, partitioning, connections, backup/DR, retention |
| [`observability-and-slo.md`](./03-cross-cutting/observability-and-slo.md) | SLOs, error budgets, traces, metrics, logs, burn-rate alerting |
| [`reliability.md`](./03-cross-cutting/reliability.md) | Failure catalogue, degradation contract, patterns, chaos, incident response |
| [`deployment-and-cicd.md`](./03-cross-cutting/deployment-and-cicd.md) | Environments, build, CI, GitOps, canary, scaling |
| [`testing-strategy.md`](./03-cross-cutting/testing-strategy.md) | Risk-targeted testing; why coverage is a floor, not a target |

### `04-review/` · `05-roadmap/`
| Document | |
|---|---|
| [`design-review-v2.md`](./04-review/design-review-v2.md) | Review of this document set; 10 fixes applied, 4 gaps accepted |
| [`implementation-roadmap.md`](./05-roadmap/implementation-roadmap.md) | 22 weeks, 9 phases, with exit criteria |

---

## The design in one page

**Design point:** 1M registered users, 200K DAU, ~700 RPS peak, sized for 1,500 with a documented path to 10K.

**Eight deployables.** Two gateways (HTTP, WebSocket) and six domain services, each owning its own database, communicating by gRPC where an answer is needed now and by Kafka events where it is not. Exactly five synchronous service-to-service edges exist, and each is listed and justified.

**The load-bearing ideas:**

| Idea | Why it matters |
|---|---|
| **UUIDv7 everywhere** | Sequential index inserts, a total-order pagination cursor with no ties, and partition pruning on ID lookup — one choice solving three problems |
| **Transactional outbox** | An entity and its event commit together. Nothing downstream is trustworthy without this |
| **Effectively-once processing** | At-least-once delivery + a `(consumer_group, event_id)` dedupe row in the handler's transaction. Naming it honestly is what keeps handlers idempotent |
| **Timelines are derived and disposable** | Redis may evict any timeline; the read path rebuilds it. This is what makes the memory budget ~7 GB instead of ~140 GB |
| **Key existence is the activity signal** | Fan-out writes only to timelines that already exist, which are exactly the recently-read ones. No activity set to maintain, no second source of truth to drift |
| **Filter at hydration, never scan** | Deleted, blocked, private, and suspended content are all handled by one read-time filter — because "remove this post from 100K timelines" cannot be implemented |
| **Blocks fail closed** | The one place the design chooses correctness over availability, recorded so it is not optimised away |

**What v1 got wrong that mattered most:** private accounts were in the schema and enforced nowhere; the dedupe table's primary key would have silently dropped events for three of four consumer groups; the timeline had no durability, no TTL, and a delete operation that cannot be built; and observability was scheduled after everything that needed it.

---

## Conventions

- Documents state **decisions**, not options. Alternatives live in `decisions.md` with the reason they were rejected.
- Every number is either derived in `system-design.md` §3 or labelled an assumption.
- Every failure mode names its degraded behaviour and its user-visible signal.
- Findings are referenced as `review Cx` (v1) or `Vx` (v2) so a design choice can be traced to the problem it solves.
- Changing a decision means updating its ADR, not contradicting it elsewhere.

## Status

| | |
|---|---|
| Design | v2.0, reviewed, approved for implementation |
| Implementation | Not started — the repo is a `nest new` scaffold |
| Next | Roadmap Phase 0 (platform foundation) |
