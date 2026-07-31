# Component Design — `search-service`

**Kind:** gRPC + Kafka consumer
**Owns:** Elasticsearch indices (**derived**), Redis trending structures (**derived**)
**Scales on:** consumer lag (indexer) and request rate (query)
**Depends on:** Elasticsearch, Redis, Kafka, post-service, identity-service, graph-service

---

## 1. Responsibility

| Owns | Not |
|---|---|
| Post and user indices | Post or user data — Postgres is the source of truth |
| Query execution and relevance | Authorization *rules* (shared `platform-authz`) |
| Trending hashtag computation | Hashtag storage (post-service) |
| Index lifecycle, reindex, reconciliation | |

**Everything here is derived and disposable.** Both indices can be rebuilt from Postgres or replayed from Kafka. That is what makes reindexing routine and search failures non-fatal.

**Search failures are never 5xx.** Elasticsearch is the least-owned component in the system (risk R4); a degraded search returns empty results with a flag, and the product remains usable.

---

## 2. Indices

Every index is addressed through an **alias**, never directly — this is what makes zero-downtime reindexing possible (§6).

```
posts_v1  ← alias: posts
users_v1  ← alias: users
```

```jsonc
// posts_v1
{
  "settings": {
    "number_of_shards": 3, "number_of_replicas": 1,
    "refresh_interval": "5s",              // not 1s: 5s meets the 30s freshness SLO far more cheaply
    "analysis": {
      "analyzer": {
        "content": { "type": "custom", "tokenizer": "standard",
                     "filter": ["lowercase", "asciifolding", "stop", "porter_stem"] },
        "username_prefix": { "type": "custom", "tokenizer": "keyword",
                             "filter": ["lowercase", "edge_ngram_2_20"] }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",                   // an unmapped field is a bug, not a new column
    "properties": {
      "id":            { "type": "keyword" },
      "author_id":     { "type": "keyword" },
      "content":       { "type": "text", "analyzer": "content" },
      "hashtags":      { "type": "keyword" },
      "mention_ids":   { "type": "keyword" },
      "lang":          { "type": "keyword" },
      "like_count":    { "type": "integer" },
      "reply_count":   { "type": "integer" },
      "author_visibility": { "type": "keyword" },   // see §4
      "author_status":     { "type": "keyword" },
      "created_at":    { "type": "date" }
    }
  }
}
```

```jsonc
// users_v1
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "id":             { "type": "keyword" },
      "username":       { "type": "text", "analyzer": "username_prefix",
                          "fields": { "exact": { "type": "keyword" } } },
      "display_name":   { "type": "text", "analyzer": "content" },
      "bio":            { "type": "text", "analyzer": "content" },
      "follower_count": { "type": "integer" },
      "is_verified":    { "type": "boolean" },
      "visibility":     { "type": "keyword" },
      "status":         { "type": "keyword" },
      "discoverable":   { "type": "boolean" },
      "created_at":     { "type": "date" }
    }
  }
}
```

Three deliberate choices:

- **`dynamic: strict`.** An unmapped field throws instead of being silently guessed. Dynamic mapping is how indices acquire 4,000 fields and stop being reindexable.
- **`refresh_interval: 5s`.** The default 1 s costs segment churn for freshness nobody measures; 5 s comfortably meets the 30-second SLO.
- **No PII beyond what is already public.** Email is never indexed. Email-based discovery, if ever added, must be a separate opt-in mechanism (`user_settings.discoverable_by_email`), not an index field.

---

## 3. Indexing

Consumer group `search-indexer` on `social.post.v1` and `social.user.v1`.

```
buffer events for up to 500 ms or 500 documents, whichever first
  → single _bulk request
  → per-item error handling:
      429 / 503        → retry ladder
      mapping conflict → DLQ + page (a schema bug, not a transient fault)
      404 on delete    → success (already gone)
  → record dedupe rows for the successful subset, then commit offsets
```

Bulk indexing is not an optimisation here — per-document indexing at 145 events/s produces enough small segments to keep merge threads permanently busy.

| Event | Action |
|---|---|
| `post.created` | Index (skip replies — they are not independently searchable in v2) |
| `post.deleted` | Delete by ID |
| `post.liked`/`unliked` | **Ignored.** `like_count` refreshes on the nightly reconcile; re-indexing a document per like would multiply write volume ~20× for a field that only breaks ties in ranking |
| `user.created`/`updated` | Upsert |
| `user.visibility_changed` | If now private: **delete every post document for that author**; update the user document |
| `user.deactivated`/`erased` | Delete the user document and all their post documents |

Deletions use `delete_by_query` on `author_id` with `conflicts=proceed`, run as a task and polled — a private-account flip for a prolific author can touch tens of thousands of documents and must not block the consumer.

Document IDs are the entity UUIDs, so indexing is idempotent by construction: a replayed `post.created` overwrites with identical content.

---

## 4. Querying

### The visibility problem

Search is the easiest place in a social system to leak private content, because the index is a flattened copy that has lost the relationship context. Two layers:

**Pre-filter in the query** — cheap, coarse, always applied:
```jsonc
"filter": [
  { "term": { "author_status": "active" } },
  { "term": { "author_visibility": "public" } }    // private authors' posts are removed from the index entirely
]
```

**Post-filter after retrieval** — exact, applied to the returned page:
```
rel = graph.GetRelationshipContext(viewer, unique author_ids)
drop authors ∈ blocked ∪ blocking ∪ muted
```

Over-fetch by 50% so the post-filter does not return a short page.

Blocks cannot be pre-filtered (they are per-viewer, and encoding them in the index would mean reindexing every document whenever anyone blocks anyone), so they must be a post-filter — and that post-filter **fails closed** if graph-service is unavailable, consistent with ADR-0015.

### Post search

```jsonc
{
  "query": {
    "bool": {
      "must": [{ "multi_match": { "query": "<q>", "fields": ["content^2", "hashtags"],
                                  "type": "best_fields", "operator": "and" } }],
      "filter": [ /* visibility */ ],
      "should": [{ "range": { "created_at": { "gte": "now-7d", "boost": 1.5 } } }]
    }
  },
  "sort": ["_score", { "created_at": "desc" }],
  "size": 30, "from": 0
}
```

`operator: and` because social search is navigational — users looking for "nestjs microservices" want both terms, not a fuzzy union. `_score` then `created_at` gives deterministic ordering for equal scores, which matters for pagination stability.

Pagination uses **`search_after`**, encoded as the opaque cursor that [`api-conventions.md`](../03-cross-cutting/api-conventions.md) §3 requires everywhere — `from`/`size` is not exposed. Deep `from` paging makes every shard collect and sort `from + size` hits, which is a well-known way to OOM a cluster, and it produces the same skip/duplicate behaviour under concurrent indexing that offset pagination produces in SQL. Results are hard-capped at 1,000 regardless.

### User search

```jsonc
{
  "query": {
    "bool": {
      "should": [
        { "term":  { "username.exact": { "value": "<q>", "boost": 10 } } },
        { "match": { "username":       { "query": "<q>", "boost": 5 } } },
        { "match": { "display_name":   { "query": "<q>", "boost": 3 } } },
        { "match": { "bio":            { "query": "<q>" } } }
      ],
      "minimum_should_match": 1,
      "filter": [{ "term": { "status": "active" } }]
    }
  },
  "sort": ["_score", { "follower_count": "desc" }]
}
```

Exact-username match is boosted 10× because someone typing a full username is navigating, not exploring. `follower_count` as a tiebreaker is a mild popularity prior and the reason it is worth keeping roughly fresh via reconciliation.

Private accounts remain *findable by username* — hiding them entirely would break the ability to request a follow — but their posts are not in the index at all.

---

## 5. Trending

Computed in **Redis**, not Elasticsearch (ADR-0014). v1 proposed `(recent/total) × log(total+1)` evaluated over the posts index on a user-facing endpoint — a full aggregation per request with no caching story.

```
on post.created, per hashtag:
  ZINCRBY trend:b:{bucket} 1 {tag}          # bucket = floor(epoch_ms / 300_000), 5 min
  EXPIRE  trend:b:{bucket} 90000            # 25 h

every 5 min (trending-compute job):
  recent   = ZUNIONSTORE over the last 12 buckets   (1 h)
  baseline = ZUNIONSTORE over the preceding 276     (23 h)
  for each tag in recent:
      r = recent[tag]
      if r < 10: skip                                # noise floor
      b = baseline[tag] / 23                         # hourly baseline rate
      score = r * log(1 + r / (b + 1))               # velocity, damped by volume
  ZADD trend:current  → read with a single ZREVRANGE
```

`r / (b + 1)` is the acceleration term: a tag at 100 uses/hour against a baseline of 2 scores far above a tag at 100 against a baseline of 95. The `log` damping stops a single burst from permanently dominating, and the noise floor keeps a hashtag used twice by one bot out of the list.

Reads are one `ZREVRANGE` — O(log n + k), independent of index size.

---

## 6. Index lifecycle

### Zero-downtime reindex
```
1  create posts_v2 with the new mapping
2  reindex posts_v1 → posts_v2 (ES reindex task, throttled)
3  replay Kafka from the reindex start offset into posts_v2 to close the gap
4  verify: doc counts within 0.1%, spot-check queries
5  atomic alias swap: remove posts→posts_v1, add posts→posts_v2
6  keep posts_v1 for 7 days, then delete
```
Step 3 is the one people forget: reindex is a point-in-time snapshot, and writes continue during it. Replaying Kafka from the snapshot offset is exactly what the retention window exists for.

### Reconciliation
Nightly, sampled: 10,000 random posts from Postgres compared against the index for presence and `like_count` drift. Emits `search_index_drift_ratio`; **> 0.1% alerts**. This is the only mechanism that catches silent divergence — a bulk error swallowed by a retry, or a consumer that lagged past retention.

### Full rebuild
Reindex from Postgres via a paged scan (UUIDv7 keyset), ~36M posts at 5,000 docs/s ≈ 2 hours, into a new index with an alias swap. The runbook exists and is rehearsed, because the ability to rebuild is what makes ES safe to run with a single replica.

---

## 7. gRPC surface

```protobuf
service SearchService {
  rpc SearchPosts    (SearchPostsRequest)    returns (SearchPostsResponse);
  rpc SearchUsers    (SearchUsersRequest)    returns (SearchUsersResponse);
  rpc SearchHashtags (SearchHashtagsRequest) returns (SearchHashtagsResponse);
  rpc GetTrending    (GetTrendingRequest)    returns (TrendingResponse);
}
```
Every response carries `degraded: bool`. Results are IDs plus scores; the gateway hydrates from post-service and identity-service, so search never serves stale bodies — only stale *matching*.

---

## 8. Failure modes

| Failure | Behaviour |
|---|---|
| ES unavailable | Empty results, `degraded: true`, **200 not 503** |
| ES slow (> 1 s) | Circuit breaker opens after 20 requests at 50% failure; fail fast |
| graph unavailable | Post-filter fails closed — only followed and self authors returned |
| Indexer lag | Stale results; alert at > 60 s |
| Mapping conflict | DLQ + page — a schema bug requiring a reindex |
| Trending job fails | Last computed set served (it has no TTL); alert on staleness > 30 min |

---

## 9. Deployment & SLIs

```yaml
search-api:     replicas 2    # HPA 2–6
search-indexer: replicas 2    # KEDA on lag, max 24
resources: { requests: {cpu: 250m, memory: 384Mi}, limits: {cpu: 1000m, memory: 512Mi} }
elasticsearch: 3 nodes, 4 GB heap each (≤50% of container memory, and under 32 GB for compressed oops)
```

| SLI | Target |
|---|---|
| `SearchPosts` p99 | < 200 ms |
| `SearchUsers` p99 | < 150 ms |
| `GetTrending` p99 | < 20 ms |
| Index freshness p99 | < 30 s |
| Index drift | < 0.1% |
| Search availability (incl. degraded) | 99.5% — lower than the API SLO, deliberately |

---

## 10. Testing

- **Unit:** query construction per input class; trending score maths including the noise floor and zero-baseline case.
- **Integration (Testcontainers: ES + Redpanda):** index → search round trip; **a private author's posts leave the index within 60 s of the flip** — the single most important test here; blocked authors are post-filtered; alias swap during live queries drops nothing.
- **Relevance:** a golden set of ~50 query/expected-result pairs, asserted in CI so a mapping or analyzer change cannot silently degrade relevance.
- **Load:** 50 QPS search with a realistic term distribution (heavy Zipf skew).

## 11. Open items

| # | Item | Default |
|---|---|---|
| 1 | Postgres FTS instead of ES (ADR-0014 alternative) | Revisit if ES operational cost outweighs relevance gains |
| 2 | Personalised ranking (boost accounts you follow) | Not v2 — needs the follow set at query time |
| 3 | Typeahead/autocomplete as a distinct low-latency path | Candidate for v2.1 — `username_prefix` is already in place |
| 4 | Multilingual analyzers | Deferred; `lang` field reserved |
