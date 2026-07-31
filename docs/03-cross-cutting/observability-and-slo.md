# Observability and SLOs

v1 scheduled all of this for weeks 15–16, after every asynchronous path had been built (review H1). That ordering is inverted here: **observability is Phase 0**. A fan-out bug spanning gateway → post → Kafka → timeline → Redis is not diagnosable from five services' logs, and retrofitting instrumentation across eight services costs several times what building with it costs.

---

## 1. SLOs

An SLO is a promise with a budget. Alerts fire on **budget burn rate**, not raw thresholds.

| # | SLI | Objective | Window | Budget |
|---|---|---|---|---|
| 1 | API availability — non-5xx / total, measured at ingress | 99.9% | 30d | 43 min |
| 2 | Timeline read latency p99 | < 250 ms | 30d | 1% of requests |
| 3 | Post create latency p99 | < 400 ms | 30d | 1% |
| 4 | Fan-out freshness p99 — post committed → in follower timeline | < 5 s | 30d | 1% |
| 5 | Notification delivery p99 — event → connected client | < 3 s | 30d | 1% |
| 6 | Search freshness p99 | < 30 s | 30d | 1% |
| 7 | Counter accuracy | drift < 0.1% | 30d | — |

SLOs 4–6 are **eventual-consistency budgets**. Making them SLOs rather than implementation details is deliberate: it converts "eventually consistent" from a hand-wave into a measured, defensible number, and it gives the fan-out design a pass/fail criterion.

Search availability is deliberately lower (99.5%) than the API SLO — search degrades to empty results rather than failing the request (ADR-0014), so it should not consume the API budget.

### Error budget policy

| Consumed | Response |
|---|---|
| < 50% | Normal feature work |
| 50–90% | Reliability work prioritised alongside features |
| > 90% | **Feature freeze**; reliability only until the budget recovers |
| Exhausted | Incident review; no risky deploys |

Writing the policy down before it is needed is the entire value — negotiating it during an outage produces the wrong answer.

---

## 2. Traces

OpenTelemetry, auto-instrumented for HTTP, gRPC, `pg`, `ioredis`, and `kafkajs`, with manual spans for anything expensive.

**Context propagates across Kafka.** The `EventEnvelope` carries `correlation_id` as a W3C `traceparent` (system design §9.1), and the consumer runtime extracts it. This is what makes an end-to-end trace possible:

```
POST /v1/posts                                    ← trace root
├─ api-gateway: authenticate                 2 ms
├─ api-gateway: rate-limit                   1 ms
├─ post-service: CreatePost                 45 ms
│  ├─ identity: ResolveUsernames             8 ms
│  └─ pg: INSERT posts + outbox             22 ms
└─ [async, same trace]
   ├─ outbox-relay: publish                180 ms
   ├─ timeline-fanout: handle              310 ms
   │  ├─ graph: GetFollowerIdsPage          40 ms
   │  └─ redis: pipeline ZADD ×247          85 ms
   ├─ search-indexer: bulk                 220 ms
   └─ notification: handle                  95 ms
```

Without cross-Kafka propagation this is five unrelated traces and the question "why did this post take 8 seconds to appear?" is unanswerable.

**Tail-based sampling**: keep 100% of errors and traces over 1 s, 1% otherwise. Head sampling at 1,500 RPS either costs too much or discards exactly the traces worth keeping.

Required span attributes: `service.name`, `service.version`, `user.id` (hashed), `http.route` (the template, never the filled path — otherwise cardinality explodes).

---

## 3. Metrics

Prometheus, scraped from `/metrics`.

### RED — every service
```
http_requests_total{service,route,method,status}
http_request_duration_seconds{service,route}          histogram
grpc_requests_total{service,method,code}
grpc_request_duration_seconds{service,method}         histogram
```

### USE — resources
```
process_cpu / nodejs_heap_size_used_bytes / nodejs_eventloop_lag_seconds
pg_pool_{active,idle,waiting}
redis_command_duration_seconds
```
`nodejs_eventloop_lag_seconds` is the highest-signal Node metric there is: sustained lag means the process is CPU-blocked and *every* latency SLI is about to degrade, usually before request latency shows it.

### Platform — the mechanisms this design depends on
```
outbox_depth{service}                     outbox_oldest_age_seconds{service}
kafka_consumer_lag{group,topic,partition} handler_duration_seconds{group,event_type}
dedupe_hits_total{group}                  retry_total{group,tier}   dlq_total{group}
circuit_breaker_state{client,target}      cache_hits_total / cache_misses_total{cache}
```

### Domain
```
posts_created_total          fanout_targets{quantile}      fanout_lag_seconds
timeline_rebuild_total       timeline_hit_ratio            timeline_memory_bytes
notifications_created_total  notification_aggregation_ratio
websocket_active_connections search_index_drift_ratio      counter_drift_ratio{counter}
auth_login_failures_total    token_reuse_detected_total
```

`timeline_rebuild_total / timeline_reads_total` is the health signal for the whole timeline design (timeline-service §10). Above ~5% in steady state, something is wrong with the TTL, Redis sizing, or eviction pressure.

**Cardinality discipline:** never a user ID, post ID, or raw path in a label. One bad label turns Prometheus into the outage.

---

## 4. Logs

Pino, JSON, one line per event, correlated by trace ID.

```json
{ "level":"info","time":"2026-07-31T10:30:00.000Z","service":"post-service","version":"1.4.2",
  "trace_id":"4bf92f...","span_id":"00f067...","user_id":"sha256:9f2b...",
  "msg":"post created","post_id":"0190f2c1-...","duration_ms":45 }
```

| Level | Use |
|---|---|
| `error` | Needs attention; always with a stack |
| `warn` | Handled but unexpected (breaker opened, retry exhausted) |
| `info` | Business events (post created, session revoked) |
| `debug` | Non-production only |

Redaction happens in the **serialiser**, not at call sites: `password`, `token`, `authorization`, `refresh_token`, `email`, `ip`. One careless `logger.info({ user })` otherwise defeats every careful call.

Logs are for narrative and forensics; metrics are for alerting. **No alert is defined on a log pattern** — log-based alerting breaks silently when a message string changes.

---

## 5. Dashboards

| Dashboard | Contents |
|---|---|
| **Service overview** (per service) | RED, saturation, event-loop lag, pool usage, breaker states |
| **SLO** | Burn rate for all seven SLOs, budget remaining, 30-day trend |
| **Timeline health** | Fan-out lag, targets/post, rebuild rate, hit ratio, Redis memory |
| **Event pipeline** | Outbox depth/age, lag per group, retry and DLQ rates, dedupe hits |
| **Data quality** | Counter drift, index drift, orphan counts, partition headroom |
| **Business** | DAU, posts, likes, follows, notification delivery |
| **Capacity** | Connections, Redis memory by keyspace, Postgres size, Kafka lag/retention |

Each dashboard opens with the question it answers, written at the top. A dashboard whose purpose is unclear during an incident is not used during an incident.

---

## 6. Alerts

### Burn-rate alerting

```yaml
# Fast burn — 2% of a 30-day budget in 1 hour → exhausted in ~2 days
- alert: APIAvailabilityFastBurn
  expr: |
    (1 - sum(rate(http_requests_total{status!~"5.."}[1h])) / sum(rate(http_requests_total[1h]))) > 14.4 * 0.001
    and
    (1 - sum(rate(http_requests_total{status!~"5.."}[5m])) / sum(rate(http_requests_total[5m])))  > 14.4 * 0.001
  for: 2m
  labels:   { severity: page }
  annotations: { runbook: "https://…/runbooks/api-availability" }

# Slow burn — 10% in 6 hours
- alert: APIAvailabilitySlowBurn
  expr: ... > 6 * 0.001
  for: 15m
  labels:   { severity: ticket }
```

The two-window condition is what stops a 30-second blip from paging: the long window establishes that the burn is real, the short window that it is still happening. v1's `rate(5xx) > 1% for 5m` (review H6) does the opposite — it pages on blips and stays silent through a slow burn that will exhaust the budget in a week.

**Every alert carries a runbook link. An alert without one is not merged.**

### Paging alerts

| Alert | Condition |
|---|---|
| API availability fast burn | above |
| Timeline latency fast burn | p99 > 250 ms burning fast |
| Fan-out lag critical | > 60 s for 5 min |
| Outbox stalled | oldest > 300 s |
| DLQ flooding | > 100 messages in 10 min |
| Database down | readiness failing 2 min |
| Redis memory critical | > 90% for 5 min |
| Token reuse detected | any occurrence |
| Certificate expiry | < 7 days |

### Ticketing alerts
Slow burns, counter drift > 0.1%, index drift > 0.1%, partition headroom < 30 days, dependency CVEs, cache hit rate < 80%, rebuild rate > 10%.

---

## 7. Stack

| Signal | Tool |
|---|---|
| Collection | OpenTelemetry Collector (DaemonSet) |
| Traces | Tempo |
| Metrics | Prometheus (+ Thanos for long retention) |
| Logs | Loki |
| Dashboards | Grafana |
| Alerting | Alertmanager → PagerDuty / Slack |
| Uptime | External synthetic checks (an internal monitor cannot report its own outage) |

Retention: traces 7 days, metrics 15 days raw + 1 year downsampled, logs 30 days, audit 1 year.

---

## 8. Instrumentation checklist

Every new service, before it ships:

- [ ] `bootstrapTelemetry()` first in `main.ts`, before instrumented imports
- [ ] `/health/live` (process only) and `/health/ready` (dependencies) — **different checks**
- [ ] `/metrics` exposed, RED metrics present
- [ ] Structured logging with trace correlation and redaction
- [ ] Spans on every outbound call
- [ ] Consumer metrics if it consumes Kafka
- [ ] Service overview dashboard
- [ ] At least one SLO, or an explicit statement of why it has none
- [ ] Runbook for each of its paging alerts
- [ ] Cardinality reviewed on every new label

---

## 9. Verifying the instrumentation

Instrumentation is code and fails like code — usually silently, and usually discovered during an incident.

- **Trace continuity test:** an integration test asserts one `trace_id` spans gateway → post → Kafka → timeline. This is the test that catches a broken propagator, which no functional test would notice.
- **Metric presence test:** scrape `/metrics` in CI and assert the required series exist.
- **Alert rule tests:** `promtool test rules` with synthetic series, asserting each alert fires when it should and stays quiet when it should not.
- **Runbook rehearsal:** each paging runbook is exercised in a game day at least quarterly.
