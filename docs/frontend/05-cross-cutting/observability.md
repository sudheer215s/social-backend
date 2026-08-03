# Frontend Observability

The backend traces a request from gateway through Kafka to consumers (`observability-and-slo.md` §2). If the trace starts at the gateway, everything the user actually experienced — parse, render, interaction delay, retries — is invisible. Starting it in the browser makes "why was this slow for this user" answerable in one view.

---

## 1. What we collect

| Signal        | Tool                    | Destination                   |
| ------------- | ----------------------- | ----------------------------- |
| Traces        | OpenTelemetry web SDK   | Same collector as the backend |
| Web Vitals    | `web-vitals` v4         | Collector → Prometheus        |
| Errors        | OTel + error boundaries | Collector → Loki              |
| Custom events | OTel counters           | Prometheus                    |

One collector for both halves of the system. Two separate observability stacks would mean correlating a frontend timing against a backend trace by hand, which nobody does during an incident.

---

## 2. Trace continuity

`traceparent` is injected by `api-client` on every request, so a browser-initiated span is the parent of the backend's entire tree:

```
[browser] click "Post"                              ← trace root
├─ [browser] mutation: createPost              12 ms
├─ [browser] fetch POST /v1/posts             180 ms
│  └─ [gateway] POST /v1/posts                165 ms
│     ├─ [gateway] authenticate                  2 ms
│     └─ [post-service] CreatePost              45 ms
│        └─ [pg] INSERT posts + outbox          22 ms
├─ [browser] optimistic insert + render        18 ms
└─ [async, same trace]
   ├─ [outbox-relay] publish                   180 ms
   └─ [timeline-fanout] handle                 310 ms
```

The value is in the gaps. If the gateway reports 165 ms and the browser reports 180 ms, the extra 15 ms is network and parse. If the browser reports 900 ms, the time went to a queued connection, a retry, or the refresh path — and that is invisible from the server side.

### Spans we create

| Span                 | Attributes                                                      |
| -------------------- | --------------------------------------------------------------- |
| `http.client` (auto) | Method, **route template**, status, retry count, degraded flags |
| `route.change`       | From/to template, duration                                      |
| `query.<key>`        | Cache hit/miss, staleness                                       |
| `mutation.<name>`    | Optimistic applied, rolled back                                 |
| `auth.refresh`       | Trigger (proactive/reactive), lock waited, result               |
| `realtime.connect`   | Attempt number, close code                                      |
| `render.timeline`    | Item count, virtualised range                                   |

`auth.refresh` is instrumented deliberately: it is the highest-risk flow in the frontend (FR1), and `lock_waited: true` with a single refresh per window is the observable proof that single-flight is working in production, not just in tests.

**Route templates, never raw paths.** `/v1/posts/{id}`, not `/v1/posts/0190f2c1-…`. Raw IDs explode cardinality exactly as the backend's observability doc warns, and they leak identifiers into a telemetry store.

---

## 3. Web Vitals

```ts
onLCP(report);
onINP(report);
onCLS(report);
onTTFB(report);
onFCP(report);

function report(metric: Metric) {
  telemetry.record(`web_vitals_${metric.name.toLowerCase()}`, metric.value, {
    route: currentRouteTemplate(),
    rating: metric.rating, // good | needs-improvement | poor
    navigation: metric.navigationType, // navigate | reload | back-forward
  });
}
```

Reported at **p75** by route, matching Core Web Vitals convention. Averages hide the tail that makes an app feel broken.

`navigationType` separates cold loads from back-forward restores. A `/home` LCP that looks poor overall is often fine on `back-forward` (served from the persisted cache) and poor on `navigate` — two different problems with two different fixes, indistinguishable if aggregated.

Beacon on `visibilitychange`, never `unload` — `unload` is unreliable on mobile Safari and blocks the back-forward cache.

---

## 4. Errors

```ts
telemetry.recordError(error, {
  route,
  component,
  traceId: error.traceId, // from problem+json
  sessionAge,
  connectionType: navigator.connection?.effectiveType,
  degraded: currentDegradations(),
});
```

Every error carries the backend's `traceId` when one exists, so a frontend error links directly to the backend trace that produced it.

`connectionType` and `degraded` are included because a large share of frontend errors are network-shaped. Knowing an error cluster is 90% `slow-2g` changes the fix from "handle this exception" to "this timeout is too short".

### Error boundaries

Per feature, not per route ([`01-architecture.md`](../01-architecture.md) §11) — a failed notification badge must not blank the feed. Each boundary reports with its feature name, so the dashboard shows _where_ failures concentrate rather than a single undifferentiated count.

`global-error.tsx` is last-resort only and is itself instrumented, since a spike there means the app shell is broken.

---

## 5. Product and health metrics

```
# Health
frontend_api_errors_total{route,status}
frontend_auth_refresh_total{trigger,result}      ← FR1 canary
frontend_session_lost_total{reason}              ← "reuse_detected" must stay ~0
frontend_realtime_state{state}
frontend_realtime_fallback_total
frontend_degraded_responses_total{subsystem}
frontend_optimistic_rollback_total{mutation}

# Product
frontend_timeline_pages_loaded
frontend_post_publish_total{result}
frontend_draft_restored_total
frontend_cache_hit_ratio{query}
```

Three of these are the ones worth watching:

- **`frontend_session_lost_total{reason="reuse_detected"}`.** Should be ~zero. A non-zero rate means either a real credential-theft incident or — far more likely — a single-flight refresh bug. It is the direct production signal for FR1.
- **`frontend_optimistic_rollback_total`.** A rising rate means the UI is routinely showing users state that then reverts. That is a correctness signal disguised as a metric.
- **`frontend_draft_restored_total`.** Every increment is a user who would otherwise have lost their writing.

---

## 6. Sampling

| Signal         | Rate                                                     |
| -------------- | -------------------------------------------------------- |
| Traces         | 1% of sessions, **100% of sessions containing an error** |
| Web Vitals     | 100% (cheap, and the distribution is the point)          |
| Errors         | 100%                                                     |
| Custom metrics | 100% (pre-aggregated)                                    |

Session-based rather than request-based trace sampling: sampling individual requests yields disconnected fragments, while sampling whole sessions gives complete user journeys. This mirrors the backend's tail-based approach — keep everything interesting, sample the rest.

Sampling decisions are made once at session start and propagated in `traceparent`, so the backend honours the same decision and traces are never half-sampled.

---

## 7. Dashboards

| Dashboard                    | Answers                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| **Web Vitals**               | p75 LCP/INP/CLS by route and navigation type; 28-day trend                   |
| **API health (client view)** | Error rate and latency by route, as the browser saw it                       |
| **Auth health**              | Refresh rate, lock contention, **session-loss reasons**                      |
| **Realtime**                 | Connection states, reconnects by close code, delivery latency, fallback rate |
| **Degradation**              | Frequency by subsystem — how often users see a partial app                   |
| **Release comparison**       | Vitals and error rate, current vs previous, for canary decisions             |

**The client-side API health dashboard is not redundant with the backend's.** They routinely disagree, and the disagreement is the finding: the backend reporting 99.9% while the browser sees 98% means failures in the network, the CDN, or a client-side retry path — all invisible from the server.

---

## 8. Alerts

| Alert              | Condition                 | Severity                                     |
| ------------------ | ------------------------- | -------------------------------------------- |
| Session-loss spike | `reuse_detected` > 5/min  | **Page** — FR1 regression or a real incident |
| Error-rate spike   | 5× baseline for 5 min     | Page                                         |
| INP regression     | p75 > 200 ms for 30 min   | Ticket                                       |
| LCP regression     | p75 > 2.5 s on any route  | Ticket                                       |
| Realtime fallback  | > 20% of sessions polling | Ticket                                       |
| Bundle budget      | Exceeded                  | CI failure, not an alert                     |

The first is the only frontend alert that pages, because it is the only frontend failure that silently signs users out.

Every alert carries a runbook link, matching the backend's rule that an alert without one is not merged.

---

## 9. Privacy

Detailed in [`security.md`](./security.md) §6. Summary: no request or response bodies, no raw URLs, no emails or post content, user IDs hashed, all paths templated. Scrubbing is applied at the exporter, not at call sites — one careless `recordError(e, { user })` otherwise defeats every careful one.

---

## 10. Verifying the instrumentation

Instrumentation is code and fails like code — usually silently, and usually discovered during an incident.

- **Trace continuity test:** an integration test asserts one `trace_id` spans browser → gateway → service, with the browser span as root. This catches a broken propagator, which no functional test would notice.
- **Scrubbing test:** an error containing an email, a token, and post content produces an exported payload with none of them.
- **Cardinality check:** CI asserts no span or metric attribute contains a UUID.
- **Sampling test:** a session flagged as errored exports 100% of its spans.
