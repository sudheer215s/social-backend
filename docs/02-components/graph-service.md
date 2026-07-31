# Component Design — `graph-service`

**Kind:** gRPC + Kafka consumer
**Owns:** `follows`, `follow_requests`, `blocks`, `mutes`, `outbox`, `processed_events`
**Scales on:** request rate; **read-critical** — it sits on the timeline hot path
**Depends on:** Postgres (`graph_db`), Redis, Kafka

---

## 1. Responsibility

Every relationship between two users. It is small in surface area and disproportionately important: it holds 100M rows, answers the fan-out question ("who follows X?"), and is the authority for blocks — the one check in the system that fails closed (ADR-0015).

| Owns | Not |
|---|---|
| Follows, including approval for private accounts | User profiles (identity-service) |
| Blocks (mutual invisibility) | Timeline placement |
| Mutes (one-way silencing) | Notification suppression — it supplies the input, notification-service applies it |
| Follower/following enumeration | Counter *storage* (identity-service holds the denormalised value) |
| The large-account registry | |

---

## 2. Data model

```sql
CREATE TABLE follows (
  follower_id  uuid        NOT NULL,
  followee_id  uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> followee_id)
);

-- The two directions are different queries and each needs its own covering index.
CREATE INDEX ix_follows_following ON follows (follower_id, created_at DESC, followee_id);
CREATE INDEX ix_follows_followers ON follows (followee_id, created_at DESC, follower_id);

CREATE TABLE follow_requests (
  requester_id uuid        NOT NULL,
  target_id    uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CONSTRAINT no_self_request CHECK (requester_id <> target_id)
);
CREATE INDEX ix_follow_requests_target ON follow_requests (target_id, created_at DESC);

CREATE TABLE blocks (
  blocker_id uuid        NOT NULL,
  blocked_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);
CREATE INDEX ix_blocks_blocked ON blocks (blocked_id, blocker_id);   -- reverse lookup

CREATE TABLE mutes (
  muter_id   uuid        NOT NULL,
  muted_id   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id)
);
```

Notes:

- **Two covering indexes on `follows`.** "Who do I follow" and "who follows me" are different index orders; v1 had only `(follower_id)` and `(following_id)` without the sort or payload columns, forcing a heap fetch per row on paginated reads (review C10). At 100M rows, index-only scans are the difference between 5 ms and 500 ms.
- **`blocks` is indexed in both directions.** `canView` needs "did A block B" *and* "did B block A" — see §5.
- **No counters here.** Counts live denormalised on `users` (identity-service), fed by events. This service can compute exact counts on demand for reconciliation.
- **Naming.** `followee_id`, not v1's `following_id`. `following_id` reads ambiguously ("the ID of the following"), and this table is queried in both directions often enough that the ambiguity causes real bugs.

### Size

100M rows × ~40 B + two indexes ≈ **14 GB**. Comfortable on a single node; sharding path in system design §12.2.

---

## 3. Follow

```
FollowUser(follower, followee):
  1  reject self-follow (constraint is the backstop, not the check)
  2  if blocks(followee → follower) or blocks(follower → followee) → NOT_FOUND
       (404, not 403: 403 would reveal the block to the blocked party)
  3  target = identity.GetUser(followee)          # cached 60 s
     if target.status ≠ active → NOT_FOUND
  4  if target.visibility = 'followers':
       INSERT follow_requests ON CONFLICT DO NOTHING
       emit follow.requested → notification
       return { state: 'requested' }
  5  BEGIN
       INSERT follows ON CONFLICT DO NOTHING
       if rowcount = 1: INSERT outbox (user.followed, key = followee_id)
     COMMIT
  6  return { state: 'following', changed: rowcount = 1 }
```

`ON CONFLICT DO NOTHING` plus the affected-row count makes follow idempotent by construction and emits the event only on a real transition — the same pattern as likes. A client retrying `PUT /users/{id}/follow` produces one event.

Step 2 returning `404` rather than `403` matters: a blocked user must not be able to detect the block by probing.

### Unfollow
```sql
DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2;
-- rowcount 1 → outbox(user.unfollowed) ; 0 → no-op
```

### Approval
Accepting a request moves it to `follows` and emits `user.followed` in one transaction. Rejecting deletes it silently — the requester is not told, which is the standard privacy behaviour.

---

## 4. Enumeration — the fan-out primitive

`GetFollowerIdsPage` is called once per fan-out per page, making it one of the hottest queries in the system.

```sql
SELECT follower_id, created_at
  FROM follows
 WHERE followee_id = $1
   AND (created_at, follower_id) < ($2, $3)     -- keyset cursor
 ORDER BY created_at DESC, follower_id DESC
 LIMIT $4;                                      -- ≤1000
```

**Keyset, never offset.** v1's `GetFollowerIds(user_id, limit, offset)` (review G3) made fan-out for a large account quadratic: paging to offset 400,000 requires the database to scan and discard 400,000 rows *on every page*. Fanning out to 500K followers would cost ~125 billion row visits instead of 500K. The keyset form is served entirely by `ix_follows_followers` as an index-only scan, at constant cost per page.

The composite `(created_at, follower_id)` cursor handles ties — many follows share a millisecond, and a `created_at`-only cursor would skip or repeat rows at page boundaries.

---

## 5. Blocks, mutes, and visibility

### Semantics

| | Block | Mute |
|---|---|---|
| Direction | Mutual invisibility | One-way |
| Existing follows | **Severed in both directions** | Preserved |
| Other party knows | Effectively yes (content vanishes) | No |
| Timeline | Hidden both ways | Muted user's posts hidden from muter |
| Notifications | Suppressed both ways | Suppressed from muted user |
| Search | Filtered both ways | Not filtered |
| New follows | Prevented | Allowed |

Blocking severs follows in both directions in the same transaction:

```sql
BEGIN;
INSERT INTO blocks VALUES ($1, $2) ON CONFLICT DO NOTHING;
DELETE FROM follows WHERE (follower_id, followee_id) IN (($1,$2), ($2,$1));
DELETE FROM follow_requests WHERE (requester_id, target_id) IN (($1,$2), ($2,$1));
INSERT INTO outbox (user.blocked, ...);
COMMIT;
-- then, synchronously, before returning:
DEL rel:blk:{blocker}   DEL rel:blk:{blocked}
```

**The cache deletion is synchronous and part of the operation's contract.** Every other cache in this system is invalidated lazily; a stale block leaks content to someone the user has explicitly excluded, which users experience as a product failure. The write does not return until both cache entries are gone.

### The visibility RPC

`GetRelationshipContext(viewer, [author_ids])` returns, for a batch of authors, whether each is blocked, blocking, muted, or followed. Timeline, search, and notification all call it — one shared decision surface, so the rule cannot drift between call sites.

```
Cached: rel:blk:{user_id}  → the user's full block set, both directions, TTL 30 s
        rel:mut:{user_id}  → mute set, TTL 60 s
        rel:fol:{user_id}  → followed set (bloom filter if > 5,000), TTL 60 s
```

Block sets are small (p99 < 100 entries), so caching the whole set per user makes the check a local set intersection rather than a round trip per author.

**These caches live in Redis only — never in a process-local cache.** Synchronous invalidation on block (above) works by deleting a Redis key; an in-process copy in timeline-service or search-service would survive that delete and keep serving a stale block for its full TTL, on an unbounded number of replicas, with no way to reach it. The one-round-trip cost of a Redis lookup is the price of being able to invalidate at all.

**Fail closed.** If graph-service is unreachable and the cache has expired, callers hide content from any author the viewer does not demonstrably follow (ADR-0015). This is the one place the design chooses correctness over availability, and it is recorded so it is not "optimised" away later.

---

## 6. The large-account registry

Feeds the timeline hybrid decision (system design §10.4).

```
graph:large               Redis Set of user_ids with follower_count > 50,000  (< 1,000 members)
graph:large:{user_id}     the large accounts THIS user follows, TTL 60 s      (typically 0–20)
```

Maintained by the `graph-large-accounts` consumer on `social.graph.v1`: it tracks follower counts and adds or removes members on threshold crossings, with **5% hysteresis** (promote at 50,000, demote at 47,500) so an account hovering at the boundary does not flap between fan-out modes with every follow and unfollow.

`GetLargeAccountsFollowed(user_id)` intersects the user's followee set with `graph:large`. On a cold cache this is one indexed query:

```sql
SELECT followee_id FROM follows
 WHERE follower_id = $1 AND followee_id = ANY($2);   -- $2 = graph:large members
```

---

## 7. gRPC surface

```protobuf
service GraphService {
  rpc Follow   (FollowRequest)   returns (FollowResponse);
  rpc Unfollow (UnfollowRequest) returns (FollowResponse);
  rpc ApproveFollowRequest (ApproveRequest) returns (FollowResponse);
  rpc RejectFollowRequest  (RejectRequest)  returns (FollowResponse);

  rpc Block (BlockRequest) returns (RelationResponse);
  rpc Unblock(BlockRequest) returns (RelationResponse);
  rpc Mute  (MuteRequest)  returns (RelationResponse);
  rpc Unmute(MuteRequest)  returns (RelationResponse);

  rpc GetFollowers (GetFollowersRequest) returns (UserIdPage);
  rpc GetFollowing (GetFollowingRequest) returns (UserIdPage);
  rpc GetFollowRequests (GetFollowRequestsRequest) returns (UserIdPage);

  // Hot path
  rpc GetFollowerIdsPage        (GetFollowerIdsPageRequest)  returns (UserIdPage);       // fan-out
  rpc GetFollowingIds           (GetFollowingIdsRequest)     returns (UserIdList);       // rebuild, ≤1000
  rpc GetLargeAccountsFollowed  (LargeAccountsRequest)       returns (UserIdList);
  rpc GetRelationshipContext    (RelContextRequest)          returns (RelContextResponse); // ≤100
  rpc CountFollowers            (CountRequest)               returns (CountResponse);      // reconcile
  rpc CountFollowing            (CountRequest)               returns (CountResponse);
}
```

`GetFollowingIds` caps at 1,000, ordered by most recent — this bounds timeline rebuild for a user following 50,000 accounts (system design §10.5). Their rebuilt timeline covers their 1,000 most recent follows, which is a deliberate, documented approximation rather than an unbounded query.

---

## 8. Events

### Published
| Event | Key | Consumers |
|---|---|---|
| `user.followed` | `followee_id` | notification, timeline, identity-counters, search |
| `user.unfollowed` | `followee_id` | timeline, identity-counters |
| `follow.requested` | `target_id` | notification |
| `user.blocked` / `user.unblocked` | `blocker_id` | timeline (cache purge), notification |

Keying by `followee_id` puts every follow event for one user in one partition, so their follower-count updates are strictly ordered and cannot interleave into a wrong value.

### Consumed
| Topic | Group | Handler |
|---|---|---|
| `social.graph.v1` | `graph-large-accounts` | Maintain `graph:large` with hysteresis |
| `social.user.v1` | `graph-cascade` | `user.erased` → enqueue edge removal |

### Cascade deletion is a job, not a handler

`user.erased` for an account with 5M followers means deleting 5M rows. v1 modelled this as an event handler (review D8), which cannot work: a Kafka handler that runs for minutes exceeds `max.poll.interval.ms`, gets the consumer evicted from the group, triggers a rebalance, and replays — forever.

Instead the handler enqueues a `graph_cascade_jobs` row and returns immediately. A worker deletes in checkpointed batches:

```sql
DELETE FROM follows
 WHERE ctid IN (SELECT ctid FROM follows WHERE followee_id = $1 LIMIT 5000);
-- loop until 0, checkpointing progress, with a pause between batches to bound replication lag
```

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Postgres unavailable | Writes 503. Reads serve from Redis relationship caches; on expiry, callers **fail closed** for blocks |
| Redis unavailable | Every relationship check hits Postgres — latency up ~10×; timeline degrades but stays correct |
| Kafka unavailable | Writes succeed; counters and timeline follow-handling lag |
| Fan-out enumeration slow | `slow_query` alert on `GetFollowerIdsPage` p99 > 100 ms — the earliest signal of `follows` index degradation |

---

## 10. Deployment & SLIs

```yaml
replicas: 3                     # HPA 3–8
resources: { requests: {cpu: 500m, memory: 512Mi}, limits: {cpu: 2000m, memory: 768Mi} }
NODE_OPTIONS: --max-old-space-size=576
readReplica: enabled for GetFollowers/GetFollowing (tolerates replica lag)
```
Enumeration reads go to a Postgres read replica; relationship checks and writes go to the primary. Enumeration tolerates lag; block checks do not.

| SLI | Target |
|---|---|
| `Follow` p99 | < 60 ms |
| `GetFollowerIdsPage` (1000) p99 | < 100 ms |
| `GetRelationshipContext` p99 | < 10 ms cached / < 40 ms cold |
| `GetLargeAccountsFollowed` p99 | < 15 ms |
| Block cache invalidation | 100% synchronous — any failure pages |

---

## 11. Testing

- **Unit:** follow state machine across public/private/blocked targets; block severing both directions; hysteresis at the large-account boundary.
- **Integration:** keyset pagination over 1M synthetic followers with no duplicates or gaps across all pages; concurrent follow/unfollow converging to one final state; block invalidating both cache entries before the call returns; cascade job over 1M edges with checkpoint resume after a kill.
- **Performance:** `EXPLAIN (ANALYZE, BUFFERS)` assertions that both enumeration queries are index-only scans — **asserted in CI**, because a schema change that silently drops index-only-ness would not fail any functional test but would degrade fan-out by 100×.
- **Load:** fan-out enumeration at 1,000 pages/s.

## 12. Open items

| # | Item | Default |
|---|---|---|
| 1 | Follow suggestions (2nd-degree) | Not v2 — needs a graph traversal store or a batch job |
| 2 | Follower list visibility for private accounts | Visible to followers only (open question Q4) |
| 3 | Block import/export | Not v2 |
| 4 | Lists / circles | Not v2; would extend `follows` with a list dimension |
