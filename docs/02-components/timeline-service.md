# Component Design — `timeline-service`

**Kind:** gRPC + Kafka consumer
**Owns:** nothing durable — Redis timelines are **derived state**
**Scales on:** consumer lag (fan-out) and request rate (read)
**Depends on:** Redis, post-service, graph-service, Kafka

> This is the component v1 specified least and needed most. v1 named the hybrid strategy without defining the read-side merge (review B2), gave timelines no TTL and no rebuild path (B1, E1), and specified a delete operation that cannot be implemented (B3). This document is that specification. The algorithm summary lives in system design §10; this covers implementation.

---

## 1. Responsibility

Produce a user's home timeline: the reverse-chronological merge of posts from accounts they follow, minus what they may not see.

| Owns | Not |
|---|---|
| The materialised timeline cache | Post content (post-service) |
| Fan-out on write | Follow relationships (graph-service) |
| The read-side merge of push and pull | Post *authorship* |
| Rebuild from source | User timelines — `GET /timelines/user/{id}` goes straight to post-service |
| Visibility filtering on the read path | The visibility *rules* (shared `platform-authz`) |

**Nothing here is a source of truth.** Every byte can be reconstructed from `posts` and `follows`. That property is what allows aggressive eviction, cheap failover, and no cross-region replication (ADR-0009).

---

## 2. Storage

```
Key     tl:h:{user_id}             Redis Sorted Set
Member  base64url(UUIDv7 bytes)    22 chars → Redis embstr encoding
Score   0                          constant
Cap     400 members
TTL     14 days, refreshed on every read
```

### Why the score is constant

Ordering comes from **lexicographic order of the member**, via `ZRANGEBYLEX`. Because UUIDv7 embeds a big-endian 48-bit millisecond timestamp and base64url preserves byte ordering, lexicographic member order *is* chronological order — with the random suffix breaking ties, so **no two members ever compare equal**.

This solves three v1 problems in one representation:

1. **Pagination correctness.** v1 scored by millisecond timestamp (review E3); two posts in the same millisecond straddling a page boundary were returned twice or skipped. A total order cannot do that.
2. **Clock skew.** v1's score was a producer-side wall clock, so two application replicas with 50 ms of drift could order posts wrongly. The v7 timestamp is assigned once, at ID generation, and travels with the ID.
3. **Cursor cost.** The cursor is the last post ID — already in the response, needing no separate encoding.

### Why 400 entries

400 posts is roughly 2–3 days of a 100-follow feed — well past where users stop scrolling. Reads beyond it fall through to the rebuild path, which serves a deeper window. The cap directly sets the Redis budget (system design §3.3): 400 × 90 B × 200K active users ≈ 7.2 GB. v1's 1,000 entries for all 1M users with no TTL was ~140 GB.

### Why timelines are evictable

`maxmemory-policy volatile-lru` may drop any timeline under pressure. That is safe — §5 rebuilds it. This is the design's central bet, and it is what makes the memory budget affordable and Redis failover a latency event rather than a data-loss event.

---

## 3. Fan-out on write

Consumer group `timeline-fanout` on `social.post.v1`.

```
on post.created:
  1  skip if reply_to_id ≠ null           # replies live in threads (open question Q1)
  2  skip if author ∈ graph:large         # pull path (§6)
  3  member = base64url(post_id)
  4  self:  EVALSHA fanout.lua 1 tl:h:{author} member   # same XX semantics as followers
  5  page followers via graph.GetFollowerIdsPage(author, cursor, 1000)
       for each batch of 500, pipelined:
         EVALSHA fanout.lua 1 tl:h:{follower} member
  6  emit fanout_fanout_targets, fanout_duration_seconds
```

```lua
-- fanout.lua · exactly one KEYS entry → Redis Cluster safe
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('ZADD',            KEYS[1], 0, ARGV[1])
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -401)
  redis.call('EXPIRE',          KEYS[1], 1209600)
  return 1
end
return 0
```

### Key existence is the activity signal

The script writes only to timelines that already exist. Since the key carries a 14-day TTL refreshed on every read, **`tl:h:{uid}` exists exactly when its owner read their timeline in the last 14 days**.

Note that step 4 applies the *same* conditional to the author's own timeline. An earlier draft wrote unconditionally to the author, on the reasoning that posting is itself activity — but that breaks the invariant above, since a write-only client (a bot, an integration) would then hold a materialised timeline it never reads. Keeping one rule everywhere is worth more than the marginal freshness: an author who returns to read gets a rebuild that includes their own posts anyway.

This is the single most load-bearing trick in the design. It means fan-out naturally targets active users with:
- no separate activity set to maintain,
- no extra round trip to consult one,
- and no possibility of the two sources disagreeing.

Dormant users are not skipped in any user-visible sense — they get a correct timeline from the rebuild path the moment they return. The effect is a ~5× reduction in fan-out volume (116/s → 23/s, system design §3.2).

### Correctness properties

| Property | Why it holds |
|---|---|
| **Idempotent** | `ZADD` with the same member and a constant score is a no-op on replay |
| **Order-independent** | Ordering derives from the member, so out-of-order arrival still yields a correctly-ordered set |
| **Cluster-safe** | One `KEYS` entry per invocation; pipelining across slots is a client concern |
| **Self-trimming** | `ZREMRANGEBYRANK` on every write caps growth without a sweeper |

Followers are read from **graph-service, not a cache**. v1's 15-minute `followers:{user_id}` cache (review E2) silently dropped fan-out for anyone who followed in the last 15 minutes, with no repair path — the new follower would simply never see those posts.

### Other handlers

| Event | Action |
|---|---|
| `post.deleted` | **Nothing.** Filtered at hydration (§7) |
| `user.followed` | Backfill: the followee's last 50 non-reply posts into the follower's timeline, if the key exists |
| `user.unfollowed` | **Nothing.** The unfollowed author's posts age out naturally within 400 entries; filtering them immediately would require scanning the set |
| `user.blocked` | `DEL tl:h:{blocker}` and `DEL tl:h:{blocked}` — cheap, correct, and rebuilt on next read |
| `user.deactivated` / `erased` | Nothing; hydration filters |

The `user.followed` backfill is what makes a new follow feel immediate: without it, a user who follows someone sees nothing from them until their next post.

---

## 4. Read path

```
GetHomeTimeline(viewer, cursor?, limit ≤ 100):

  lo = cursor ? base64url(cursor) : "+"          # ZREVRANGEBYLEX upper bound

  ── A. materialised ────────────────────────────────────────────
  ids_m = ZREVRANGEBYLEX tl:h:{viewer} (lo - LIMIT 0 (limit*3)
  if key missing            → REBUILD (§5) → retry once
  if ids_m exhausted        → DEEP PAGE (§4a)
  EXPIRE tl:h:{viewer} 1209600                   # refresh the activity signal

  ── B. pull + relationships (parallel with A) ──────────────────
  large  = graph.GetLargeAccountsFollowed(viewer)            # cached 60 s
  ids_p  = post.GetRecentPostIdsByAuthors(large, since=lo, limit)   # cached 30 s/author
  rel    = graph.GetRelationshipContext(viewer, candidate authors)  # cached 30 s

  ── C. merge ───────────────────────────────────────────────────
  ids = sort_desc(dedupe(ids_m ∪ ids_p))         # UUIDv7 → total order, no ties

  ── D. filter, before hydration ────────────────────────────────
  drop authors ∈ rel.blocked ∪ rel.blocking ∪ rel.muted
  drop authors with visibility='followers' ∉ rel.following
  take limit + slack (slack = ceil(limit * 0.5))

  ── E. hydrate ─────────────────────────────────────────────────
  posts = post.GetPostsByIds(page_ids)           # batch ≤ 100
  drop tombstones → lazily ZREM them from tl:h:{viewer}
  if len < limit and candidates remain → iterate from C (max 3 passes)
  truncate to limit

  ── F. cursor ──────────────────────────────────────────────────
  next_cursor = opaque(last returned post id)
  has_more    = candidates remained after truncation
```

### 4a. Deep pagination — past the materialised window

The materialised set holds 400 entries. A user who scrolls past it reaches the end of the sorted set while older posts still exist. An earlier draft claimed these reads "fall through to the rebuild path" — they do not: rebuild triggers on a *missing key*, not on an exhausted range, so as written the timeline would simply end at 400 with `has_more: false`.

Exhaustion is therefore an explicit branch:

```
DEEP PAGE(viewer, cursor):
  acquire the same 200-concurrency rebuild semaphore
  following = graph.GetFollowingIds(viewer, limit 1000)     # cached 60 s
  ids = post.GetRecentPostIdsByAuthors(following, before = cursor, limit = limit*3)
  # LATERAL form, per-author cap — see post-service §5
  → merge into the normal pipeline at step C; do NOT write these into tl:h:{viewer}
  emit timeline_deep_page_total
```

Deep pages are **not** written back to the sorted set: doing so would either exceed the 400 cap or evict the fresh head of the timeline that every other read depends on. They are computed per request, which is affordable because they are rare — reaching entry 400 means scrolling roughly two to three days back, which a small fraction of sessions do.

This is fan-out-on-read, applied exactly where its cost is justified: the deeper the scroll, the fewer the readers.

| Depth | Path | Typical latency |
|---|---|---|
| Entries 1–400 | Materialised | ~50 ms |
| Beyond 400 | Deep page | ~150 ms |
| Cold key, any depth | Rebuild, then as above | ~200 ms |

### Pagination stability

Both sources are queried with the same `< cursor` bound in the same total order. A post therefore sorts strictly before or strictly after the cursor — never both, never neither. Consequences:

- No duplicates and no gaps across pages, even while new posts arrive mid-scroll.
- New posts appear only on a fresh page-1 request, never injected mid-scroll.
- The merge is deterministic: re-requesting the same cursor returns the same page (modulo deletions).

### Why filtering precedes hydration

Filtering by author is cheap (a set lookup against `rel`); hydration is a network round trip. Filtering first means the ≤100-item batch is spent on posts that will actually be returned. Hydration can still remove items (tombstones), which is what the slack and the bounded re-loop cover.

The 3-pass cap bounds worst-case latency. A viewer whose entire visible window is blocked or deleted gets a short page with `has_more: true` rather than an unbounded loop — a rare, honest outcome.

### Budget for p99 < 250 ms

| Stage | Typical |
|---|---|
| A — `ZREVRANGEBYLEX` | 2 ms |
| B — parallel gRPC, cached | 15 ms |
| C/D — in-process merge and filter | 2 ms |
| E — hydration of ≤30 posts | 25 ms |
| Serialisation | 5 ms |
| **Total** | **~50 ms**, with the rebuild branch (§5) as the outlier |

---

## 5. Rebuild

Runs when `tl:h:{viewer}` is missing: a new user, a dormant user returning, an eviction, or a Redis failover. This is a **primary code path**, not a fallback — after a Redis failover it is the only path, for every user at once.

```
REBUILD(viewer):
  acquire local semaphore (max 200 concurrent, process-wide)   # ← protects Postgres
  following = graph.GetFollowingIds(viewer, limit 1000)        # most recent 1000
  if following empty → ZADD sentinel, EXPIRE, return empty
  ids = post.GetRecentPostIdsByAuthors(following, since = now-7d, limit 400)
  pipeline: ZADD tl:h:{viewer} 0 <members> ; EXPIRE 1209600
  emit timeline_rebuild_total, timeline_rebuild_duration_seconds
```

Backed by:
```sql
SELECT id FROM posts
 WHERE author_id = ANY($1) AND deleted_at IS NULL AND reply_to_id IS NULL AND id > $2
 ORDER BY id DESC LIMIT 400;
-- index-only via ix_posts_author_feed
```

### Bounds and why each exists

| Bound | Value | Reason |
|---|---|---|
| Following considered | 1,000 most recent | A user following 50,000 accounts would otherwise issue an unbounded `ANY()` |
| Lookback | 7 days | Bounds the partitions scanned |
| Result | 400 | Matches the cap |
| Global concurrency | 200 | **Risk R2** — the stampede limiter |
| Target latency | p99 < 150 ms | Measured separately from the cached path |

The sentinel for users following nobody matters: without it, every read by a new user retries the rebuild, hammering Postgres for a guaranteed-empty result.

The concurrency limiter is the difference between a Redis failover being a latency blip and being a full outage. Without it, 200K active users all take the rebuild path simultaneously and saturate the Postgres primary. With it, requests queue behind a bounded number of rebuilds and shed load predictably. **This path is chaos-tested by killing the Redis primary under load** — it is not credible until it has been.

---

## 6. Large accounts (the pull path)

An account is large at `follower_count > 50,000` — derived in system design §3.2 as the point where one post's fan-out costs a meaningful fraction of a consumer-second. graph-service maintains the registry with 5% hysteresis.

| | Fan-out on write | Pull on read |
|---|---|---|
| Accounts | ~99.9% | < 1,000 |
| Cost per post | O(active followers) | 0 |
| Cost per read | 0 | 1 cached RPC + merge |
| Freshness | ≤ 5 s | Immediate |

Pull results are cached 30 s per author, so a large account's recent-posts query is answered from cache for essentially every one of its followers — the cost is O(large accounts), not O(readers).

### Transitions need no backfill

Crossing upward stops future fan-out; already-fanned posts remain and are harmlessly deduped against the pull results. Crossing downward resumes fan-out; older posts continue to arrive via pull until they age out of the pull window. **The merge makes both transitions safe with no migration**, which is why the threshold can be tuned freely in production.

---

## 7. Deletes and visibility changes

v1 specified "remove post from all timelines" — not implementable, since a post may sit in 100K sorted sets with no reverse index (review B3).

**Everything is filtered at hydration.** `GetPostsByIds` returns tombstones for deleted posts; the read path drops them and lazily `ZREM`s them from the timeline it was already reading.

| Change | Mechanism | Latency |
|---|---|---|
| Post deleted | Tombstone at hydration | Immediate |
| Author blocked viewer | `rel` filter | ≤ 30 s (cache), immediate on the blocker's own read |
| Author went private | Visibility filter | Immediate |
| Author deactivated/suspended | Tombstone at hydration | Immediate |

One mechanism, four cases, O(reads) cost, self-cleaning, no reverse index. The lazy `ZREM` means a timeline that is read repeatedly converges to containing only visible posts.

---

## 8. gRPC surface

```protobuf
service TimelineService {
  rpc GetHomeTimeline (GetHomeTimelineRequest) returns (TimelinePage);
  rpc InvalidateTimeline (InvalidateRequest) returns (InvalidateResponse);   // ops/support
  rpc GetTimelineStats  (StatsRequest)       returns (StatsResponse);        // debug
}

message TimelinePage {
  repeated HydratedPost posts = 1;
  string next_cursor = 2;
  bool   has_more    = 3;
  repeated string degraded = 4;   // e.g. ["timeline-pull"] — surfaced as X-Degraded
}
```

`degraded` is part of the contract, not an afterthought: the client is told when it is looking at a partial timeline, and the gateway maps it to a response header.

---

## 9. Failure modes

| Failure | Behaviour | Signal |
|---|---|---|
| Redis unavailable | Every read rebuilds against Postgres, limited to 200 concurrent, `limit` forced to 20 | `timeline-cache` |
| graph unavailable | Materialised-only; **blocks fail closed** — hide any author not demonstrably followed | `timeline-pull` |
| post unavailable | Serve from post cache; omit unhydratable IDs | `post-hydration` |
| Fan-out lag > 60 s | Read path widens the pull window to cover the lag | `fanout-lag` |
| Rebuild limiter saturated | Queue up to 500 ms, then 503 with `Retry-After` | `timeline-overload` |

### Lag compensation

The service reads its own consumer lag from the fan-out group. When lag exceeds 60 s, the read path extends the pull window to cover it — including non-large accounts posted in the lagging window. Fan-out falling behind degrades toward fan-out-on-read for the affected window, at higher read cost, rather than silently serving a stale timeline. This is bounded by the same 200-concurrency limiter.

---

## 10. Deployment & SLIs

```yaml
# Two deployments — different scaling signals, one codebase.
timeline-api:
  replicas: 3          # HPA 3–12 on CPU + RPS
  resources: { requests: {cpu: 500m, memory: 512Mi}, limits: {cpu: 2000m, memory: 768Mi} }
timeline-fanout:
  replicas: 2          # KEDA on lag, max 24 (= partitions of social.post.v1)
  resources: { requests: {cpu: 250m, memory: 384Mi}, limits: {cpu: 1000m, memory: 512Mi} }
NODE_OPTIONS: --max-old-space-size=576   # api / 384 for fanout
terminationGracePeriodSeconds: 60        # fan-out must finish in-flight batches
```

The fan-out consumer's 60-second grace period exists because a SIGTERM mid-fan-out must complete the current batch and commit the offset; killing it early is safe (replay is idempotent) but wasteful.

| SLI | Target |
|---|---|
| `GetHomeTimeline` p99 (warm) | < 250 ms |
| `GetHomeTimeline` p99 (rebuild) | < 400 ms |
| Rebuild rate | < 5% of reads in steady state |
| Fan-out lag p99 | < 5 s |
| Fan-out targets/post p99 | < 5,000 |
| Redis timeline memory | < 10 GB |
| Timeline hit rate | > 95% |

Rebuild rate is the health signal for the whole design. Above ~5%, either the TTL is too short, Redis is under-provisioned, or eviction pressure is coming from another keyspace.

---

## 11. Testing

- **Unit:** merge/dedupe/sort over synthetic ID sets; cursor encode/decode round-trip; slack and the 3-pass cap; the visibility filter against a table of viewer/author combinations.
- **Integration (Testcontainers: Redis + Postgres + Redpanda):**
  - Fan-out writes only to existing keys — assert a dormant follower's key is *not* created.
  - Replaying the same `post.created` 100× leaves the ZSET unchanged.
  - Paginate a 400-entry timeline fully: no duplicates, no gaps, stable while new posts are inserted concurrently.
  - Rebuild produces the same page-1 as the materialised path for an equivalent follow set — **the correctness invariant that makes eviction safe**.
  - Deleted post is filtered and `ZREM`ed within one read.
  - Block invalidates and the blocked author disappears within one read.
- **Chaos:** kill the Redis primary at 500 RPS — assert the rebuild limiter holds, Postgres connections stay bounded, and no request exceeds 2 s.
- **Load:** 1,000 RPS reads with a 5% cold-key rate.

## 12. Open items

| # | Item | Default |
|---|---|---|
| 1 | Do replies appear in home timelines? (open question Q1 — ~3× fan-out volume) | No |
| 2 | Reposts as separate entries or resolved at hydration? (Q2) | Separate entries |
| 3 | "New posts" indicator without a full fetch | `ZCOUNT` above the client's last-seen cursor |
| 4 | Ranking | Deferred (ADR-0016); insertion point is between D and E |
