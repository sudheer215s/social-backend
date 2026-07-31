# Component Design — `realtime-gateway`

**Kind:** WebSocket server · stateful (connections), no durable storage
**Owns:** the connection registry (Redis, ephemeral)
**Scales on:** concurrent connections
**Depends on:** Redis (streams + registry), identity-service, notification-service

> Split out of the API gateway. v1 placed WebSocket handling inside the stateless HTTP gateway (review B4), which means every HTTP rollout drops every connection, and the two components' scaling signals — RPS and concurrent connections — cannot both be served by one HPA.

---

## 1. Responsibility

| Does | Does not |
|---|---|
| Accept and authenticate WebSocket connections | Serve HTTP APIs |
| Maintain the user → connection registry | Create notifications |
| Read per-user Redis Streams and push | Store anything durable |
| Replay missed notifications on reconnect | Make authorization decisions |
| Enforce connection and message limits | Handle chat (not in v2) |

---

## 2. Connection lifecycle

### Authentication by ticket

WebSocket clients cannot set an `Authorization` header from a browser, and putting a JWT in the query string leaks it into access logs, referrers, and proxy caches. Two-step instead:

```
1  POST /v1/realtime/ticket        (normal HTTP, Bearer auth)
   → identity.IssueRealtimeTicket(user_id)
   → { ticket, expires_in: 30 }
       ticket = opaque 32-byte random
       Redis: SET rt:tk:{sha256(ticket)} {user_id, sid} EX 30 NX

2  WSS /v1/realtime?ticket=…
   → GETDEL rt:tk:{sha256(ticket)}          # single-use, atomic
   → miss → close 4401
   → hit  → bind connection to user_id + sid
```

`GETDEL` makes the ticket single-use atomically, so a leaked URL in a log is worthless 30 seconds later and cannot be replayed even within the window.

### Session expiry mid-connection

A connection can outlive the access token that authorised it. v1 did not address this (review F9); an unaddressed connection is effectively an unexpiring credential.

```
every 60 s per connection:
  if sid ∈ revoked set (Redis)        → close 4403 "session revoked"
  if connection age > 12 h            → close 4408 "reauthenticate"
```
The client obtains a fresh ticket and reconnects. Reconnect is cheap because catch-up (§4) makes it lossless.

### Registry

```
ws:u:{user_id}   SET of "{instance_id}:{conn_id}"   TTL 90 s, refreshed by heartbeat
ws:i:{instance}  SET of user_ids on this instance   TTL 90 s
```
Registry entries are TTL-based, not delete-based, so a hard pod kill self-heals in 90 seconds instead of leaking entries forever. The registry answers "is this user connected anywhere" for presence and for skipping work; it is not on the delivery path.

### Limits

| Limit | Value | Enforcement |
|---|---|---|
| Connections per user | 5 | Oldest closed with 4409 on the sixth |
| Connections per instance | 20,000 | New connections rejected; HPA reacts |
| Inbound messages | 10/s per connection | Token bucket; close 4429 on sustained breach |
| Inbound frame size | 4 KB | Close 1009 |
| Idle timeout | 120 s without a pong | Close 1001 |

---

## 3. Protocol

JSON frames. Compact and versioned:

```jsonc
// server → client
{ "t": "ready",        "d": { "since": "0190f2c1-…" } }
{ "t": "notification", "d": { "id": "…", "type": "like", "actor": {…}, "entity": {…}, "created_at": "…" } }
{ "t": "unread",       "d": { "count": 12 } }
{ "t": "pong" }
{ "t": "error",        "d": { "code": "rate_limited", "retry_after": 5 } }

// client → server
{ "t": "ping" }
{ "t": "ack",       "d": { "id": "0190f2c1-…" } }   // stream cursor advance
{ "t": "subscribe", "d": { "since": "0190f2c1-…" } } // catch-up request
```

Application-level `ping`/`pong` in addition to protocol-level frames, because intermediary proxies frequently drop WebSocket ping frames and the connection then dies silently.

---

## 4. Delivery

```
on connect:
  cursor = client.since ?? "$"                     # "$" = only new entries
  register in ws:u / ws:i
  if client.since: XRANGE ntf:s:{uid} (since + COUNT 200   → replay
  send { t: "ready", since: <newest id> }

loop:
  XREAD BLOCK 5000 COUNT 50 STREAMS ntf:s:{uid} <cursor>
  for each entry: hydrate via notification.GetByIds (batched across users) → push
  cursor = last id
  on client ack: persist cursor in Redis (ws:c:{uid}:{conn}) TTL 1 h
```

### One reader per user per instance

Multiple tabs share a single `XREAD` and the message is broadcast to that user's local connections. Otherwise five tabs mean five blocking reads against the same stream — and at 20,000 connections per instance, five times the Redis connections needed.

### Hydration batching

Stream entries carry only an ID (see notification-service §5). The gateway accumulates IDs for up to 50 ms across *all* connected users and issues one batched `GetByIds`. At the design point this collapses hundreds of individual RPCs per second into a handful, and it is why the stream deliberately carries a pointer rather than a payload.

### Delivery semantics

**At-least-once.** A client may see a duplicate after reconnect if it acked and then dropped before the cursor persisted. Clients dedupe by notification ID — stated in the protocol contract, because "at-least-once" is only safe when the consumer knows it.

---

## 5. Scaling and deployment

```yaml
replicas: 2                                  # HPA 2–10
resources: { requests: {cpu: 250m, memory: 512Mi}, limits: {cpu: 1000m, memory: 1Gi} }
NODE_OPTIONS: --max-old-space-size=768
hpa:
  - custom metric: websocket_active_connections > 12000 per pod
terminationGracePeriodSeconds: 60
lifecycle.preStop: sleep 15
sessionAffinity: none                        # any instance can serve any user
```

Memory is the binding constraint, not CPU: ~20 KB per connection × 20,000 ≈ 400 MB, plus heap. Scaling on CPU would never trigger before the pod ran out of memory.

### Draining

```
SIGTERM → stop accepting new connections
        → send { t: "error", code: "reconnect" } to all
        → close with 1012 (Service Restart) in batches of 500 over 30 s
        → exit
```

Batched, staggered closes matter: closing 20,000 connections at once produces a synchronised reconnect storm against the remaining instances, which is how a routine rollout becomes an outage. Clients reconnect with jittered backoff and their `since` cursor, so nothing is lost.

---

## 6. Failure modes

| Failure | Behaviour |
|---|---|
| Redis unavailable | Connections stay open; no delivery; clients fall back to polling `/v1/notifications` |
| notification unavailable | IDs buffered up to 1,000/instance; push resumes on recovery; overflow drops to catch-up |
| identity unavailable | New connections rejected (no tickets); existing connections unaffected |
| Instance killed | Registry TTL expires in 90 s; clients reconnect with jitter |
| Reconnect storm | Server-advertised jittered backoff (`retry_after`), plus per-IP connection rate limiting |

The polling fallback is what keeps realtime an *enhancement*: a total failure of this component degrades notification latency from ~1 s to the client's poll interval. Nothing is lost, because Postgres holds the record.

---

## 7. SLIs

| SLI | Target |
|---|---|
| Connection establishment p99 | < 500 ms |
| Notification → client push p99 | < 1 s |
| Connection drop rate (excl. deploys) | < 0.1%/min |
| Catch-up replay success | > 99.9% |
| Memory per connection | < 25 KB |

---

## 8. Testing

- **Unit:** ticket single-use (`GETDEL` semantics under concurrency); protocol frame validation; per-connection rate limiting.
- **Integration:** connect → notification → push end-to-end; disconnect for 30 s, reconnect with `since`, assert exactly the missed set replays; five tabs share one `XREAD`; sixth connection evicts the oldest.
- **Load:** 20,000 concurrent connections on one instance — measure memory per connection and drain time.
- **Chaos:** kill an instance under load; assert clients reconnect within 30 s with no lost notifications and no thundering herd.

## 9. Open items

| # | Item | Default |
|---|---|---|
| 1 | Typing indicators / presence broadcast | Not v2; would need a presence channel |
| 2 | Live timeline updates ("3 new posts") | Candidate for v2.1 — the stream already exists |
| 3 | Binary protocol (MessagePack/protobuf frames) | JSON until frame volume justifies it |
| 4 | SSE fallback for restrictive networks | Worth adding; the delivery loop is transport-agnostic |
