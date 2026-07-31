# Component Design — `post-service`

**Kind:** gRPC + Kafka consumer
**Owns:** `posts`, `likes`, `hashtags`, `post_hashtags`, `mentions`, `outbox`, `processed_events`
**Scales on:** request rate (gRPC) and consumer lag (counters)
**Depends on:** Postgres (`post_db`), Redis, Kafka, identity-service (mention resolution)

---

## 1. Responsibility

Authoritative store for content and interactions.

| Owns | Not |
|---|---|
| Post lifecycle: create, read, soft delete | Timeline placement (timeline-service) |
| Replies (threading) and reposts | Notifications (notification-service) |
| Likes — the `likes` row is the source of truth | Search indexing (search-service) |
| `#hashtag` and `@mention` extraction | Follow relationships (graph-service) |
| Content validation and normalisation | Media storage — `media_refs` are opaque |
| Post-level visibility enforcement | |

---

## 2. Data model

```sql
CREATE TABLE posts (
  id            uuid        NOT NULL,                    -- UUIDv7
  author_id     uuid        NOT NULL,
  content       text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 280),
  media_refs    text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(media_refs) <= 4),
  reply_to_id   uuid,                                    -- direct parent
  thread_root_id uuid,                                   -- denormalised root, for cheap thread reads
  repost_of_id  uuid,
  lang          text,
  like_count    bigint      NOT NULL DEFAULT 0 CHECK (like_count   >= 0),
  reply_count   bigint      NOT NULL DEFAULT 0 CHECK (reply_count  >= 0),
  repost_count  bigint      NOT NULL DEFAULT 0 CHECK (repost_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    text CHECK (deleted_by IN ('author','moderator','erasure')),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- monthly partitions, created 3 months ahead by a job

-- The three access patterns, each with a partial index that excludes deleted rows.
CREATE INDEX ix_posts_author_feed ON posts (author_id, id DESC)
  WHERE deleted_at IS NULL AND reply_to_id IS NULL;       -- profile feed + timeline rebuild
CREATE INDEX ix_posts_thread      ON posts (thread_root_id, id)
  WHERE deleted_at IS NULL;                               -- thread reads
CREATE INDEX ix_posts_reply       ON posts (reply_to_id, id)
  WHERE deleted_at IS NULL AND reply_to_id IS NOT NULL;   -- direct replies

CREATE TABLE likes (
  post_id    uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
) PARTITION BY HASH (post_id);
-- 32 partitions
CREATE INDEX ix_likes_user ON likes (user_id, created_at DESC);

CREATE TABLE hashtags (
  id         uuid PRIMARY KEY,
  tag        text NOT NULL UNIQUE,        -- normalised: lowercase, NFKC
  tag_display text NOT NULL,              -- first-seen casing, for rendering
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE post_hashtags (
  post_id    uuid NOT NULL,
  hashtag_id uuid NOT NULL REFERENCES hashtags(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, hashtag_id)
);
CREATE INDEX ix_post_hashtags_tag ON post_hashtags (hashtag_id, post_id DESC);

CREATE TABLE mentions (
  post_id           uuid NOT NULL,
  mentioned_user_id uuid,                 -- NULL until resolved
  raw_username      text NOT NULL,
  resolved_at       timestamptz,
  PRIMARY KEY (post_id, raw_username)
);
CREATE INDEX ix_mentions_unresolved ON mentions (post_id) WHERE mentioned_user_id IS NULL;
CREATE INDEX ix_mentions_user       ON mentions (mentioned_user_id) WHERE mentioned_user_id IS NOT NULL;
```

Design notes, each fixing a specific v1 problem:

- **`likes` hash-partitioned ×32.** 730M rows/year (system design §3.4) makes this the largest table in the system. Hashing on `post_id` keeps "who liked this post" within one partition, which is the dominant query. Unpartitioned (review C2), index bloat and vacuum become an operational problem within months.
- **`posts` range-partitioned monthly.** Makes retention and archival a `DETACH`, and keeps the hot partition small enough to stay largely cached.
- **Every index is partial on `deleted_at IS NULL`** (review C6). Soft-deleted rows carry no index weight.
- **`thread_root_id` denormalised.** Reading a thread otherwise needs a recursive CTE per read; storing the root makes it one index range scan.
- **`hashtags.id` is a UUID**, not `SERIAL` (review C9), and `tag` is normalised (lowercase + NFKC) with the original casing preserved separately — so `#NestJS` and `#nestjs` are the same tag but still render as the author typed them.
- **`mentions.mentioned_user_id` is nullable.** Mention resolution calls identity-service; if that call fails, the post still saves and `mention-repair` resolves it later (system design §5.2 edge 5). The write path never fails because of an enrichment lookup.
- **`media_refs` are opaque IDs, not URLs** — the backend never dereferences user-supplied URLs, closing the SSRF vector in review F11.

---

## 3. Create post

```
1  validate: length after NFKC normalisation and grapheme counting (not UTF-16 units)
2  extract:  #tags (max 10) and @mentions (max 10), both deduped
3  resolve:  identity.ResolveUsernames(mentions)   deadline 300 ms, failure tolerated
4  BEGIN
     INSERT posts (id = UUIDv7 generated in-process)
     UPSERT hashtags · INSERT post_hashtags
     INSERT mentions (resolved or not)
     if reply:  thread_root_id = parent.thread_root_id ?? parent.id
     INSERT outbox (post.created, partition_key = author_id)
   COMMIT
5  return the persisted post
```

Three things worth calling out:

**Length is counted in graphemes, not code units.** `"👨‍👩‍👧‍👦"` is one user-perceived character, 7 code points, 11 UTF-16 units. Using `content.length` in JavaScript would reject a post the user sees as well within the limit — and would let a crafted string exceed the byte budget.

**`reply_count` is not incremented here.** Incrementing the parent inside the child's transaction takes a lock on the parent row, serialising every reply to a popular post. It is handled asynchronously in §6.

**The ID is generated in-process**, before the insert, because the outbox row in the same transaction needs it.

### Reply and repost rules

| Case | Rule |
|---|---|
| Reply to a deleted post | Allowed; the thread renders a tombstone in place of the parent |
| Reply depth | Unlimited storage; the API returns at most 200 per thread page |
| Repost of a repost | Collapses to the original (`repost_of_id` always points at the root content) |
| Repost with comment ("quote") | A normal post carrying `repost_of_id` and non-empty content |
| Self-repost | Allowed (a re-share to one's own timeline) |
| Duplicate repost | `UNIQUE (author_id, repost_of_id) WHERE content = ''` prevents accidental doubles |

---

## 4. Likes

The relation row is the source of truth; the counter is derived. This is what makes like/unlike naturally idempotent with no idempotency key (review C1, C4).

```sql
-- Like
INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;
-- rowcount 1 → state changed, emit post.liked
-- rowcount 0 → already liked, emit nothing, return the same 200

-- Unlike
DELETE FROM likes WHERE post_id = $1 AND user_id = $2;
-- rowcount 1 → emit post.unliked ; 0 → no-op
```

The affected-row count tells the caller whether the state actually changed, so events fire exactly on transitions. A client retrying `PUT /posts/{id}/like` five times produces one event and one durable row.

`like_count` is **never** updated on this path. It is applied by the `post-counters` consumer with **1-second delta batching** (§6): a post taking 1,000 likes/second costs one row update per second rather than 1,000 serialised row locks. The counter lags by ≤1 second and is reconciled nightly — an explicit application of the consistency model (system design §6).

---

## 5. gRPC surface

```protobuf
service PostService {
  rpc CreatePost   (CreatePostRequest)   returns (Post);
  rpc GetPost      (GetPostRequest)      returns (Post);
  rpc GetPostsByIds(GetPostsByIdsRequest) returns (GetPostsByIdsResponse);   // ≤100
  rpc DeletePost   (DeletePostRequest)   returns (DeletePostResponse);

  rpc LikePost     (LikePostRequest)     returns (LikeResponse);
  rpc UnlikePost   (UnlikePostRequest)   returns (LikeResponse);
  rpc GetLikers    (GetLikersRequest)    returns (LikersResponse);
  rpc GetViewerStates(GetViewerStatesRequest) returns (GetViewerStatesResponse); // liked/reposted

  rpc GetPostsByAuthor    (GetPostsByAuthorRequest)    returns (PostPage);
  rpc GetThread           (GetThreadRequest)           returns (PostPage);
  rpc GetReplies          (GetRepliesRequest)          returns (PostPage);

  // Timeline support
  rpc GetRecentPostIdsByAuthors(GetRecentPostIdsByAuthorsRequest) returns (PostIdList);
  rpc CountPostsByAuthor       (CountPostsByAuthorRequest)        returns (CountResponse);
}
```

`GetPostsByIds` returns a **map keyed by post ID**, containing found posts only, with deleted posts represented as an explicit tombstone (`{id, deleted: true}`). Callers must handle absence. This is what lets timeline hydration filter deleted posts without a second round trip (system design §10.7).

### Partition pruning on ID lookup

`posts` is range-partitioned on `created_at`, so its primary key is `(id, created_at)`. A lookup by `id` alone would have to scan **every** partition — a hidden linear cost that grows with every month of history, on the hottest query in the system.

UUIDv7 resolves this without a secondary structure: the ID embeds its own creation millisecond, so the partition is derivable from the key.

```sql
-- created_at is reconstructed from the UUIDv7 prefix, in the application
SELECT * FROM posts
 WHERE (id, created_at) IN ((:id1, :ts1), (:id2, :ts2), …);
```
The planner prunes to the one or two partitions the batch actually spans. This is a second, less obvious payoff of ADR-0003 — the same property that makes IDs valid cursors makes them partition-routable.

### Timeline rebuild and pull primitive

`GetRecentPostIdsByAuthors` takes up to 1,000 author IDs. The obvious form is a trap:

```sql
-- ❌ scans every matching row for all 1,000 authors, then sorts and discards
SELECT id FROM posts
 WHERE author_id = ANY($1) AND deleted_at IS NULL AND reply_to_id IS NULL AND id > $2
 ORDER BY id DESC LIMIT 400;
```

With `LIMIT 400` over 1,000 prolific authors, Postgres must produce every qualifying row before it can sort. The bounded form pushes the limit *inside* the per-author scan:

```sql
-- ✅ 1,000 short index-only scans, each stopping after 20 rows
SELECT p.id
  FROM unnest($1::uuid[]) AS a(author_id)
  CROSS JOIN LATERAL (
        SELECT id FROM posts
         WHERE author_id = a.author_id
           AND deleted_at IS NULL AND reply_to_id IS NULL
           AND id > $2                       -- UUIDv7 lower bound == time bound
         ORDER BY id DESC
         LIMIT 20
  ) AS p
 ORDER BY p.id DESC
 LIMIT $3;                                   -- ≤400
```

Each inner scan is served by `ix_posts_author_feed` and terminates after 20 rows, so the work is bounded at 1,000 × 20 regardless of how much the authors have posted. The per-author cap of 20 also improves the result: one hyperactive account can no longer monopolise a rebuilt timeline.

The `id > $2` bound works as a time bound because UUIDv7 is time-ordered (ADR-0003) — one index serves both the identity and the recency predicate.

There are **no server-streaming RPCs** (review B6).

---

## 6. Events

### Published
| Event | Key | Payload | Consumers |
|---|---|---|---|
| `post.created` | `author_id` | id, author_id, reply_to_id, repost_of_id, thread_root_id, hashtags, mention ids, created_at | timeline, search, notification, identity |
| `post.deleted` | `author_id` | id, author_id, thread_root_id | timeline, search, notification, identity |
| `post.liked` | `author_id` (post owner) | post_id, owner_id, actor_id | notification, post-counters |
| `post.unliked` | `author_id` | post_id, owner_id, actor_id | post-counters |
| `post.replied` | `author_id` (parent owner) | post_id, parent_id, parent_owner_id, actor_id | notification, post-counters |
| `post.reposted` | `author_id` (original owner) | post_id, original_id, original_owner_id, actor_id | notification, post-counters |

`post.liked` is keyed by the **post owner**, not the actor. That is what serialises all interaction events for one user's content into one partition, so their notification ordering and counter updates are consistent. Keying by actor would scatter them.

Payloads carry identifiers, never profile fields — keeping PII out of Kafka is what makes the erasure design in system design §8.6 tractable.

### Consumed — `post-counters`

```
tick every 1 s:
  drain the in-memory delta map: { post_id → {like: Δ, reply: Δ, repost: Δ} }
  BEGIN
    INSERT INTO processed_events (consumer_group, event_id) …ON CONFLICT DO NOTHING  (batched)
    UPDATE posts SET like_count = like_count + d.like, … FROM (VALUES …) AS d
     WHERE posts.id = d.post_id
  COMMIT
  commit Kafka offsets
```

Offsets are committed only after the transaction, so a crash mid-window replays the window — absorbed by the dedupe rows, which are inserted in the same transaction as the counter update. In-memory batching between offset commits is safe precisely because the two are transactionally linked.

Also consumed: `social.user.v1` → `user.erased` triggers deletion or tombstone-reassignment of the user's posts.

---

## 7. Delete

```
UPDATE posts SET deleted_at = now(), deleted_by = $2
 WHERE id = $1 AND author_id = $3 AND deleted_at IS NULL;   -- ownership in the predicate
```

Ownership is enforced in the `WHERE` clause rather than by a read-then-write, which would be a TOCTOU race. `rowcount = 0` maps to `404` (not `403` — `403` would confirm the post exists, review §11.1).

Downstream: search deletes the document; timelines filter at hydration and lazily `ZREM` (system design §10.7); notifications referencing the post are suppressed at render. **Nothing scans timelines** — the operation is O(1) here regardless of how many timelines contain the post.

Content is retained for 30 days for moderation appeal, then hard-deleted by partition maintenance.

---

## 8. Caching

| Key | Type | TTL | Notes |
|---|---|---|---|
| `p:{post_id}` | Hash | 30 min | Deleted on delete; counters are *not* cached (they change constantly) |
| `p:th:{root_id}` | List | 5 min | Thread page 1 only |
| `p:a:{author_id}:p1` | List | 60 s | Profile feed page 1 — the hottest read after timelines |

Counters are deliberately excluded from the post cache and read from the row. Caching a value that changes every second yields a low hit rate and a visibly stale number, which users notice on their own posts.

Single-flight on miss: a viral post whose cache entry expires must not send thousands of concurrent requests to Postgres for the same row.

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Postgres unavailable | Writes 503; reads serve from cache with `X-Degraded` |
| identity unavailable | Post creates fine with unresolved mentions; `mention-repair` fixes them within 15 min |
| Kafka unavailable | Writes succeed (outbox absorbs); timeline/search/notifications lag; alerts on outbox depth |
| Counter consumer lag | Counters stale; SLO alert at > 30 s lag; correctness restored nightly |
| Hot partition on `likes` | Detected via per-partition write latency; mitigation is raising partition count (a rebuild, planned) |

---

## 10. Deployment & SLIs

```yaml
replicas: 3                     # HPA 3–10 on CPU 70% + RPS
consumer: separate deployment   # KEDA on lag, max = 24 (partition count)
resources: { requests: {cpu: 500m, memory: 512Mi}, limits: {cpu: 2000m, memory: 768Mi} }
NODE_OPTIONS: --max-old-space-size=576
```
The consumer runs as its own deployment because it scales on lag while the gRPC server scales on RPS (ADR-0013) — one process cannot serve two scaling signals.

| SLI | Target |
|---|---|
| `CreatePost` p99 | < 150 ms |
| `GetPost` p99 | < 20 ms cached / < 50 ms cold |
| `GetPostsByIds` (100) p99 | < 60 ms |
| `GetRecentPostIdsByAuthors` p99 | < 80 ms |
| Like p99 | < 40 ms |
| Counter lag p99 | < 5 s |

---

## 11. Testing

- **Unit:** grapheme-accurate length counting (emoji ZWJ sequences, combining marks); hashtag normalisation (`#NestJS` ≡ `#nestjs`, Unicode confusables); mention extraction against adversarial input (`@@`, `@a@b`, trailing punctuation); thread-root derivation.
- **Integration:** concurrent like/unlike from the same user (final state must match the last operation); 1,000 concurrent likes on one post (exactly 1,000 rows, one counter update per second, final count exact); reply to a deleted parent; counter consumer replaying an offset range (counts must not move).
- **Contract:** `buf breaking` against main.
- **Load:** 200 likes/s on a single post to validate delta batching removes row contention.

## 12. Open items

| # | Item | Default |
|---|---|---|
| 1 | Edit posts | Not v2 — edits break the "timeline stores IDs" assumption for cached bodies |
| 2 | Polls, long-form | Not v2 |
| 3 | Bookmarks | Straightforward: a second relation table with the same idempotency shape as `likes` |
| 4 | Language detection for `lang` | Deferred; column reserved |
