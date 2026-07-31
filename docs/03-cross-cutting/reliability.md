# Reliability and Failure Modes

Every failure mode, what it degrades to, and how it is verified. The design principle throughout: **a degraded response beats an error, and an error beats a wrong answer.**

---

## 1. Availability arithmetic

Composed availability is worse than any component's. Seven services at 99.9% in series would give ~99.3% — about 5 hours of downtime a month.

The design does not accept that composition. Only three components are on the *critical* path for a timeline read (gateway, timeline, post), and two of the three degrade rather than fail:

| Dependency | Critical? | Degrades to |
|---|---|---|
| api-gateway | Yes | — |
| identity (JWT verify) | No | JWKS cached 5 min |
| timeline | Yes | — |
| post (hydration) | Partially | Cached bodies; omit the rest |
| graph (pull + blocks) | No | Materialised-only, blocks fail closed |
| Redis | No | Rebuild from Postgres |
| search | No | Empty results |
| Kafka | No | Outbox absorbs; freshness degrades |
| Postgres | **Yes** | Nothing — this is the one hard dependency |

Effective read availability ≈ gateway × timeline × Postgres ≈ **99.7%** if each of those three is independently 99.9%.

> **This is in tension with SLO 1 (99.9% API availability), and the tension is real.** The 99.9% objective is only achievable if the three critical components are each *better* than 99.9% — which is why Postgres is a managed service with HA and tested failover (targeting 99.95%), and why gateway and timeline are multi-replica, multi-zone, and shed load rather than fail. The composition above is the pessimistic bound; it is stated rather than hidden because it identifies precisely where reliability spend belongs. If the API SLO is being missed, the arithmetic says the cause is in one of three places, not eight.

Naming the single hard dependency is more useful than an availability number: it tells you where the next increment of reliability work goes.

---

## 2. Failure catalogue

### Infrastructure

| Failure | Blast radius | Detection | Behaviour | Recovery |
|---|---|---|---|---|
| Postgres primary down | Writes fail globally | Readiness, 30 s | Writes 503; reads from replica + cache | Automatic failover 30–60 s |
| Postgres replica lag | Stale enumeration reads | `pg_replication_lag` | Reads shift to primary above 5 s | Automatic |
| PgBouncer down | All DB access | Readiness | 503 | Restart; 3 replicas |
| Redis primary down | Cache + timelines + streams | Client errors | Rebuild path; realtime drops to polling | Cluster failover 10–30 s |
| Redis memory pressure | Evictions | `used_memory_ratio` | Timelines evicted first (`volatile-lru`) — **by design** | Scale up |
| Kafka broker down | None with RF=3 | Broker metrics | Partitions rebalance | Automatic |
| Kafka cluster down | Async plane stops | Producer errors | Outbox grows; writes still succeed | Manual |
| Elasticsearch down | Search only | Breaker | Empty results, `degraded: true` | Restart/reindex |
| Node/AZ loss | ⅓ of pods | Node conditions | Rescheduled; PDB + topology spread hold capacity | 2–5 min |

The Redis line is the one to notice: eviction of timelines is not a failure, it is the designed pressure-relief valve (ADR-0009). The alert exists to prompt capacity work, not an emergency.

### Application

| Failure | Behaviour |
|---|---|
| Service OOMKilled | Restarted; PDB keeps capacity. **Prevented by `--max-old-space-size` below the container limit** (review H4) |
| Poison message | Retry ladder → DLQ; partition never blocks (review D5) |
| Consumer lag | KEDA scales to the partition cap; timeline read path compensates |
| Outbox stalled | Alert on oldest-age; relay restart; rows are durable |
| Breaker open | Fail fast with a fallback; no queueing |
| Deploy regression | Canary analysis aborts the rollout automatically |
| Migration failure | Rollout blocked; previous version keeps serving |

---

## 3. Degradation contract

| Level | Meaning | Client signal |
|---|---|---|
| **Full** | All sources healthy | — |
| **Degraded** | Partial data, correct as far as it goes | `X-Degraded: <subsystems>` |
| **Minimal** | Core reads only | `X-Degraded` + reduced page size |
| **Read-only** | Writes rejected | 503 on writes with `Retry-After` |
| **Down** | — | 503 |

Degradation is **always signalled**. A silently partial timeline is indistinguishable from a correct one, so the client cannot retry, the user cannot tell, and the incident is discovered from a support ticket rather than a header.

---

## 4. Reliability patterns

### Timeouts and deadlines
Deadlines propagate from the inbound request; timeouts are never fixed. A fixed timeout deep in a call chain outlives the client waiting on it and turns cancelled work into wasted capacity. Servers reject already-expired deadlines without doing the work.

```
client 5 s → gateway 4.9 s → timeline 4.8 s → post 4.7 s
```

### Retries
Only on idempotent operations, only on `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `RESOURCE_EXHAUSTED`, max 2 attempts, exponential backoff with **full jitter**, and a **10% retry budget**.

The budget is the important part. Without it, retries convert a partial outage into a total one: every client retrying triples load on a service that is already failing, and the failure becomes self-sustaining long after the original cause is gone.

### Circuit breakers
```
volumeThreshold: 20      errorThreshold: 50%
halfOpenAfter: 15 s      halfOpenMax: 3 concurrent
```
Per client-target pair. The volume threshold prevents a breaker tripping on two failures out of three requests at 3 AM.

### Bulkheads
Independent connection pools per dependency, a 200-concurrency limiter on timeline rebuilds, and 8 MB Kafka fetch caps. The rebuild limiter is the most important: without it, a Redis failover routes every read to Postgres simultaneously and converts a cache outage into a database outage (risk R2).

### Load shedding
Shed when the event-loop lag exceeds 200 ms or the queue exceeds 1,000: reject with 503 + `Retry-After`, preserving health checks and in-flight requests. Shedding early keeps p99 sane for the requests that are served; refusing to shed makes every request slow and none succeed.

---

## 5. Graceful shutdown

Missing from v1 entirely (review H3). Pod termination and endpoint removal are **concurrent, not ordered** — without a `preStop` sleep, kube-proxy keeps routing to a pod that has already begun shutting down.

```
SIGTERM
  ├─ preStop: sleep 10 s          ← endpoints deregister while still serving
  ├─ readiness → false
  ├─ stop accepting new work
  ├─ drain in-flight (≤30 s)
  ├─ consumers: finish batch, commit offsets, leave the group
  ├─ close pools and channels
  └─ exit 0
terminationGracePeriodSeconds: 45 (60 for fan-out)
```

Nest's `enableShutdownHooks()` wires this; the consumer runtime handles the Kafka portion. Killing a consumer mid-batch is safe (replay is idempotent) but wasteful, so the grace period is generous.

---

## 6. Kubernetes resilience

```yaml
podDisruptionBudget: { minAvailable: 2 }        # or 50% for larger deployments
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
resources:
  requests: { cpu: 250m, memory: 384Mi }
  limits:   { cpu: 1000m, memory: 512Mi }        # memory limit == request for Guaranteed QoS
env:
  - NODE_OPTIONS: --max-old-space-size=384       # < the container limit, always
livenessProbe:   { httpGet: /health/live,  periodSeconds: 10, failureThreshold: 3 }
readinessProbe:  { httpGet: /health/ready, periodSeconds: 5,  failureThreshold: 2 }
startupProbe:    { httpGet: /health/live,  failureThreshold: 30, periodSeconds: 2 }
```

Two rules that are violated constantly and cause most self-inflicted Kubernetes outages:

1. **Liveness must not check dependencies.** A Redis blip that fails a dependency-aware liveness probe restarts the entire fleet at once (review H7). Liveness answers only "is this process wedged".
2. **`--max-old-space-size` must be below the container limit.** Node's default heap target ignores cgroup limits, so the process is OOMKilled instead of collecting garbage (review H4).

Memory limit equal to request gives Guaranteed QoS, so these pods are evicted last under node pressure.

---

## 7. Data integrity under failure

| Guarantee | Mechanism |
|---|---|
| No entity without its event | Transactional outbox — same transaction (system design §9.4) |
| No event applied twice | `(consumer_group, event_id)` dedupe in the handler's transaction |
| No duplicate posts on retry | `Idempotency-Key` with an in-flight marker |
| No duplicate likes/follows | `ON CONFLICT DO NOTHING`; the relation row is the truth |
| No lost notifications | Postgres is durable; the stream is only a delivery buffer |
| No corrupt timelines | Derived and rebuildable; `ZADD` is idempotent |
| No negative counters | `CHECK (>= 0)` + nightly reconciliation |

Each of these is a *structural* guarantee — it holds because of a database constraint or a transaction boundary, not because a handler remembered to check.

---

## 8. Chaos and verification

A degraded mode that has never been exercised is a hypothesis. Monthly game days:

| Experiment | Assertion |
|---|---|
| Kill Redis primary at 500 RPS | Rebuild limiter holds, Postgres connections bounded, no request > 2 s |
| Kill a Kafka broker | No message loss, consumers rebalance < 30 s |
| Postgres failover | Writes resume < 60 s, no data loss, no duplicate side effects |
| Kill graph-service | Timelines degrade, **blocks still enforced** |
| Inject a poison message | DLQ receives it, the partition keeps moving |
| Drain a node | PDB holds, no dropped requests |
| Expire all JWKS caches during rotation | No auth failures |
| Saturate the fan-out consumer | Read path widens the pull window; freshness SLO holds |

The graph-service and poison-message experiments are the two that most often reveal a design that only worked on paper.

---

## 9. Incident response

| Severity | Definition | Response |
|---|---|---|
| SEV1 | Full outage or data loss | Page, all hands, status page |
| SEV2 | Major degradation, SLO burning fast | Page, on-call + owner |
| SEV3 | Minor degradation | Ticket, business hours |

Flow: detect (alert) → acknowledge → assess (dashboards, traces) → mitigate (rollback, scale, shed, degrade) → resolve → **blameless postmortem within 5 business days for SEV1/2**.

Mitigation precedes diagnosis. Rolling back an unknown regression is faster and safer than understanding it first.

### Runbooks

`docs/runbooks/`, one per paging alert, each with: symptoms, dashboards, likely causes, mitigation steps, escalation, and the postmortem template.

| Runbook |
|---|
| `api-availability` · `timeline-latency` · `fanout-lag` · `outbox-stalled` |
| `dlq-redrive` · `redis-failover` · `postgres-failover` · `kafka-broker-loss` |
| `search-reindex` · `counter-drift` · `token-reuse` · `certificate-expiry` |

---

## 10. Capacity and cost guardrails

Reviewed monthly against the design point (system design §3). Alert when any resource crosses 70% of its provisioned headroom:

| Resource | Headroom trigger |
|---|---|
| Redis memory | > 70% of 36 GB |
| Postgres storage | > 70% |
| Kafka disk | > 70% |
| Connection pools | > 70% saturation |
| Consumer parallelism | replicas approaching the partition count |

The last one is the least obvious and the most important to catch early: once consumer replicas equal the partition count, scaling stops working, and increasing partitions is a disruptive operation that must be planned rather than performed during an incident.
