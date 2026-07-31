# Component Design — `notification-service`

**Kind:** gRPC + Kafka consumer
**Owns:** `notifications`, `outbox`, `processed_events`
**Scales on:** consumer lag
**Depends on:** Postgres (`notification_db`), Redis (streams, cache), Kafka, identity-service, graph-service

---

## 1. Responsibility

Turn domain events into per-user notifications, apply preferences and relationship filters, aggregate the noisy ones, and hand them to `realtime-gateway` for delivery.

| Owns | Not |
|---|---|
| Notification records and read state | WebSocket connections (`realtime-gateway`) |
| Preference enforcement | Preference *storage* (identity-service) |
| Aggregation ("X and 49 others") | Email delivery (a separate sender consumes `social.notification.v1`) |
| Publishing to the delivery stream | Push/APNs/FCM (not in v2) |

---

## 2. Data model

```sql
CREATE TABLE notifications (
  id            uuid        NOT NULL,                    -- UUIDv7
  user_id       uuid        NOT NULL,                    -- recipient
  type          text        NOT NULL CHECK (type IN
                  ('follow','follow_request','like','reply','mention','repost')),
  entity_type   text,                                    -- 'post' | 'user'
  entity_id     uuid,
  actor_ids     uuid[]      NOT NULL DEFAULT '{}',       -- most recent first, capped at 8
  actor_count   int         NOT NULL DEFAULT 1,          -- true total, may exceed cardinality(actor_ids)
  group_key     text        NOT NULL,                    -- aggregation identity
  group_window  bigint      NOT NULL,                    -- floor(epoch_ms / window_ms); see §4
  is_read       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- monthly partitions; dropped after 90 days

CREATE UNIQUE INDEX uq_notif_group
  ON notifications (user_id, group_key, group_window, created_at);
CREATE INDEX ix_notif_user_feed ON notifications (user_id, id DESC);
CREATE INDEX ix_notif_unread    ON notifications (user_id) WHERE is_read = false;
```

> **Why `group_window` is a stored column rather than an index predicate.** The natural expression of "one group per key per hour" is a partial index with `WHERE created_at > now() - interval '1 hour'`. That is **invalid**: index predicates must be `IMMUTABLE`, and `now()` is not — Postgres rejects it outright. Bucketing the window into a stored integer makes the constraint expressible, and it also makes the window boundary explicit and testable rather than relative to statement time.

Notes:

- **`actor_ids` capped at 8, `actor_count` unbounded.** The UI renders "Alice, Bob and 47 others"; storing 50 actor UUIDs to render three is waste. v1 proposed capping at 100 — 12× the storage for information no client displays.
- **No `message` column.** v1 stored a rendered string (`"{actor} liked your post"`). Storing rendered text means a display-name change makes every historical notification wrong, and localisation becomes a migration. Rendering happens at read time from `type` + hydrated actors.
- **Partitioned monthly with 90-day retention.** 250M rows/year (system design §3.4); retention is a partition `DROP`, not a `DELETE`.
- **Partial unique index on the aggregation window.** Enforces "one open group per key per hour" in the database rather than in application logic, closing the race in §4.

---

## 3. Event processing

Consumer group `notification-processor` on `social.post.v1` and `social.graph.v1`.

| Event | Recipient | Type | Suppressed when |
|---|---|---|---|
| `user.followed` | followee | `follow` | self · `notify_on_follow=false` · blocked/muted |
| `follow.requested` | target | `follow_request` | blocked |
| `post.liked` | post owner | `like` | self-like · `notify_on_like=false` · blocked/muted |
| `post.replied` | parent owner | `reply` | self-reply · `notify_on_reply=false` · blocked/muted |
| `post.reposted` | original owner | `repost` | self · `notify_on_repost=false` · blocked/muted |
| `post.created` (with mentions) | each mentioned user | `mention` | self · `notify_on_mention=false` · blocked/muted |

```
handle(event):
  BEGIN
    INSERT processed_events (consumer_group, event_id) ON CONFLICT DO NOTHING
    if rowcount = 0 → ROLLBACK, commit offset, return          # already handled
    if actor = recipient → record and return                   # never notify yourself
    settings = identity.GetSettings(recipient)                 # cached 5 min
    if type disabled → record and return
    rel = graph.GetRelationshipContext(recipient, [actor])     # cached 30 s
    if actor blocked/blocking/muted → record and return
    UPSERT notification (§4)
  COMMIT
  XADD ntf:s:{recipient} MAXLEN ~200                           # after commit, §5
  commit offset
```

The dedupe row is inserted **even when the notification is suppressed**. Otherwise a replay after a preference change would produce a notification for an event the user already declined — the suppression decision must be as durable as the notification itself.

`XADD` happens **after** the transaction commits. Publishing first would let a rollback deliver a notification that does not exist. Crashing between commit and `XADD` loses the realtime push but not the record; the client picks it up on its next fetch or reconnect.

### Out-of-order and missing referents

There is no ordering across topics (system design §9.2), so `post.liked` can arrive before `post.created`. Handlers never assume the referent exists: the notification is written with the entity ID, and rendering resolves it later. If the post is gone at render time, the notification is filtered from the response. Nothing is retried on a missing referent — retrying would ladder to the DLQ for the common, benign case of a deleted post.

---

## 4. Aggregation

Fifty likes in an hour must be one notification, not fifty (v1 §12.2 described this without specifying the mechanism).

```
group_key = f(type):
  like    → "like:{post_id}"
  reply   → "reply:{post_id}"
  repost  → "repost:{post_id}"
  follow  → "follow"                # all follows aggregate into one rolling group
  mention → "mention:{post_id}"     # effectively never aggregates
```

```sql
-- group_window = floor(epoch_ms / window_ms_for(type))  -- computed in the application
INSERT INTO notifications (id, user_id, type, entity_type, entity_id,
                           actor_ids, actor_count, group_key, group_window, created_at)
VALUES ($id, $user, $type, $et, $eid, ARRAY[$actor], 1, $gkey, $gwin, now())
ON CONFLICT (user_id, group_key, group_window, created_at)
DO UPDATE SET
  actor_ids   = (SELECT array_agg(DISTINCT a ORDER BY a DESC)
                   FROM unnest(array_prepend($actor, notifications.actor_ids)) a
                  LIMIT 8),
  actor_count = notifications.actor_count
                + CASE WHEN $actor = ANY(notifications.actor_ids) THEN 0 ELSE 1 END,
  is_read     = false,                    -- new activity re-surfaces the group
  updated_at  = now();
```

One statement, atomic. Two concurrent likes on the same post cannot create two groups, because the unique index arbitrates — v1's read-then-write description would race under exactly the load that makes aggregation necessary.

**Windows** are fixed buckets, not sliding: `group_window = floor(epoch_ms / window_ms)`. Likes/reposts 1 h, replies 15 min (conversations need granularity), follows 6 h, mentions never (the window is 0, so every mention is its own group).

Fixed buckets mean a group can close early — two likes 5 minutes apart but straddling a bucket boundary produce two notifications. That is the accepted cost of an atomic, index-enforced constraint; a true sliding window requires a read-then-write and reintroduces the race. In practice the visible effect is rare and benign.

Re-marking an aggregated group unread on new activity is deliberate: a user who read "3 people liked this" should see it again at 30.

---

## 5. Delivery

Redis **Streams**, one per user. Rationale in ADR-0011; v1's pub/sub silently dropped notifications for any user not connected at that instant.

```
XADD ntf:s:{user_id} MAXLEN ~200 * id <notif_id> type <type> ts <ms>
EXPIRE ntf:s:{user_id} 2592000        # 30 days
```

The stream carries a **pointer, not a payload**: the notification ID and type only. `realtime-gateway` hydrates via gRPC. This keeps stream memory bounded and predictable (risk R3), and means a notification is never delivered in a stale rendering — actor names are resolved at delivery time.

`MAXLEN ~200` (approximate trimming) is O(1) amortised, unlike exact trimming.

### Catch-up

A reconnecting client sends its `last_seen_id`; the gateway issues `XRANGE ntf:s:{uid} (last_seen_id +`. Missed notifications up to 200 deep replay automatically. Beyond that, the client falls back to `GET /v1/notifications`, and the response's newest ID re-seeds the cursor.

---

## 6. Read API

```protobuf
service NotificationService {
  rpc GetNotifications (GetNotificationsRequest) returns (NotificationPage);
  rpc GetUnreadCount   (GetUnreadCountRequest)   returns (UnreadCountResponse);
  rpc MarkRead         (MarkReadRequest)         returns (MarkReadResponse);
  rpc MarkAllRead      (MarkAllReadRequest)      returns (MarkReadResponse);
  rpc GetByIds         (GetByIdsRequest)         returns (NotificationList);  // gateway hydration
}
```

Read path:
```
1  SELECT … WHERE user_id = $1 AND id < $cursor ORDER BY id DESC LIMIT $n
2  batch-hydrate actors    → identity.GetUsersByIds (≤100 unique)
3  batch-hydrate entities  → post.GetPostsByIds
4  drop notifications whose entity is deleted or whose actors are all now invisible
5  render per type + locale
```

Step 4 is why notification deletion is never needed on post delete: an orphaned notification is filtered at read time, the same mechanism the timeline uses (system design §10.7).

**Unread count** is maintained in Redis (`ntf:u:{uid}`) — `INCR` on create, `DECRBY` on mark-read, recomputed from Postgres on cache miss. The badge is read on essentially every client poll and must not be a `COUNT(*)`.

---

## 7. Failure modes

| Failure | Behaviour |
|---|---|
| identity unavailable | Preferences default to **enabled** — a missed notification is worse than an extra one, and the user can still mute (system design §5.2 edge 4) |
| graph unavailable | Relationship filter defaults to **allow**, *except* blocks, which fail closed |
| Redis unavailable | Notifications still persist; no realtime push; clients see them on next fetch |
| Postgres unavailable | Consumer pauses (does not commit offsets); Kafka retains; catches up on recovery |
| Consumer lag | Notifications delayed, never lost; SLO alert at > 30 s |

Preferences failing open and blocks failing closed in the same handler is intentional: the cost of being wrong differs by direction. An unwanted like notification is an annoyance; a notification from someone you blocked is a product failure.

---

## 8. Deployment & SLIs

```yaml
notification-api:      replicas 2   # HPA 2–6
notification-consumer: replicas 2   # KEDA on lag, max 24
resources: { requests: {cpu: 250m, memory: 384Mi}, limits: {cpu: 1000m, memory: 512Mi} }
NODE_OPTIONS: --max-old-space-size=384
```

| SLI | Target |
|---|---|
| Event → notification persisted p99 | < 2 s |
| Persisted → connected client p99 | < 1 s |
| `GetNotifications` (20, hydrated) p99 | < 120 ms |
| `GetUnreadCount` p99 | < 10 ms |
| Consumer lag p99 | < 10 s |
| Aggregation ratio | > 3:1 on like-heavy accounts |

---

## 9. Testing

- **Unit:** group-key derivation; window boundaries; `actor_ids` cap with the true count preserved; self-notification suppression on every type.
- **Integration:** 50 concurrent likes on one post produce exactly one notification with `actor_count = 50` and `cardinality(actor_ids) = 8`; replaying the same event 100× changes nothing; a suppressed event still records dedupe so a replay after a preference change stays suppressed; catch-up via `XRANGE` after a simulated disconnect.
- **Load:** 500 likes/s on one post — assert the aggregation `UPSERT` does not become a row-lock bottleneck.

## 10. Open items

| # | Item | Default |
|---|---|---|
| 1 | Email digest sender | Separate consumer on `social.notification.v1`; not v2 |
| 2 | Mobile push (APNs/FCM) | Not v2; the stream is the integration point |
| 3 | Per-type quiet hours | Not v2 |
| 4 | Retention beyond 90 days (open question Q3) | 90 days |
