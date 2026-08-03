# Module — `data`

**Responsibility:** every interaction with server state — queries, mutations, cache keys, optimistic updates, pagination.
**Depends on:** `api-client`
**Consumed by:** `features/` (exclusively; features never touch `api-client`)

---

## 1. Cache key registry

One file owns every key. Ad-hoc `queryKey` literals in features are a lint error.

```ts
// data/keys.ts
export const keys = {
  session: ['session'] as const,
  me: ['me'] as const,

  timelineHome: () => ['timeline', 'home'] as const,
  timelineUser: (id: string) => ['timeline', 'user', id] as const,

  post: (id: string) => ['post', id] as const,
  postReplies: (id: string) => ['post', id, 'replies'] as const,
  postLikers: (id: string) => ['post', id, 'likers'] as const,

  user: (id: string) => ['user', id] as const,
  userByUsername: (u: string) => ['user', 'username', u] as const,
  userFollowers: (id: string) => ['user', id, 'followers'] as const,

  notifications: () => ['notifications'] as const,
  notificationsUnread: () => ['notifications', 'unread'] as const,

  searchPosts: (q: string) => ['search', 'posts', q] as const,
  trending: () => ['trending'] as const,
} as const;
```

Hierarchical prefixes make partial invalidation precise: `invalidateQueries({ queryKey: ['post', id] })` clears the post, its replies, and its likers in one call. Flat string keys cannot express that, and the result is either over-invalidation (refetch storms) or under-invalidation (stale UI).

---

## 2. Staleness, derived from the backend's own SLOs

`staleTime` is not guessed. Each value comes from the backend's stated consistency bound (system design §6), so the client never refetches faster than the data can actually change.

```ts
const STALE = {
  session: Infinity, // changes only via explicit auth events
  me: 5 * 60_000,
  timeline: 30_000, // freshness SLO is 5 s; 30 s avoids pointless churn
  post: 60_000,
  user: 5 * 60_000,
  notifications: 30_000, // WS pushes make polling a fallback
  search: 0, // always fresh; user-initiated
  trending: 5 * 60_000, // recomputed every 5 min server-side
};
```

`trending` matching the server's 5-minute job cadence is the clearest example: polling faster returns identical bytes and burns the user's search rate budget.

> **There is deliberately no `counters` entry.** An earlier draft listed `counters: 10_000` to match the backend's stated counter lag — but no query fetches counters independently. `like_count` and the viewer's `liked` flag arrive embedded in post objects, composed by the gateway (`api-gateway.md` §8), so they are refreshed exactly when their containing post or timeline page is. A separate staleness value for them was dead configuration implying a query that does not exist. Counter freshness is governed by §5's delta reconciliation, not by a refetch interval.

`refetchOnWindowFocus` is enabled for the timeline and notifications and **explicitly disabled for search** — returning to a tab should update the feed, but re-running the last search costs a request against a 30/min budget for a result the user has already read.

---

## 3. Cursor pagination

Maps directly onto the backend envelope (`api-conventions.md` §3).

```ts
export function useHomeTimeline() {
  return useInfiniteQuery({
    queryKey: keys.timelineHome(),
    queryFn: ({ pageParam, signal }) =>
      api.timelines.home({ cursor: pageParam, limit: 20 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? last.page.next_cursor : undefined,
    staleTime: STALE.timeline,
    maxPages: 10, // ← bound memory; see below
  });
}
```

### Rules

**Cursors are opaque.** Never parsed, compared, sliced, or constructed. The backend reserves the right to move to ranked pages, at which point a cursor stops being a post ID (ADR-0016). A lint rule forbids string operations on values named `cursor`.

**`maxPages: 10`.** Without it, a long scroll session accumulates unbounded pages in memory — 200 posts is fine, 2,000 is not on the target device. Older pages are dropped and re-fetched if the user scrolls back, which is rare.

**Never `refetch()` an infinite query on mutation.** It re-fetches every loaded page, which is both expensive and visibly disruptive. Use targeted `setQueryData` instead (§4).

**Deep pages are slower, not different.** Past entry 400 the backend switches to a deep-page query at higher latency (`timeline-service.md` §4a). The client only needs the longer timeline deadline; no special-casing.

---

## 4. Mutation patterns

Two shapes, chosen by what the backend actually guarantees.

### 4a. State assertions — like, follow, repost, block, mute

Idempotent `PUT`/`DELETE`, no idempotency key, optimistic boolean.

```ts
export function useLike(postId: string) {
  return useMutation({
    mutationFn: (liked: boolean) =>
      liked ? api.posts.like(postId) : api.posts.unlike(postId),

    onMutate: async (liked) => {
      await queryClient.cancelQueries({ queryKey: keys.post(postId) });
      const snapshot = captureAcross(postId); // post + every timeline page holding it
      setViewerLiked(postId, liked); // authoritative boolean
      setCountDelta(postId, 'like', liked ? +1 : -1); // display-only overlay — §5
      return { snapshot };
    },

    onError: (_e, _v, ctx) => restore(ctx!.snapshot),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.post(postId) }),
  });
}
```

`captureAcross` matters: a post appears in the timeline, possibly in a profile feed, in search results, and in its own detail query. Rolling back only the detail query leaves three stale copies showing a like that failed.

### 4b. Creations — post, reply, repost-with-comment

Requires an idempotency key owned by the draft (FE-0009), and inserts optimistically.

```ts
export function useCreatePost() {
  return useMutation({
    mutationFn: ({ content, idempotencyKey }: CreateInput) =>
      api.posts.create({ content }, idempotencyKey),

    onMutate: async ({ content, draftId }) => {
      const optimistic = buildOptimisticPost(content, draftId);
      prependToTimeline(keys.timelineHome(), optimistic);
      return { draftId };
    },

    onSuccess: (real, _v, ctx) => replaceOptimistic(ctx!.draftId, real),
    onError: (_e, _v, ctx) => markOptimisticFailed(ctx!.draftId), // keep it, offer retry
  });
}
```

**The optimistic post is replaced by ID, not removed on refetch.** Fan-out takes up to 5 s (system design §1), so a refetch inside that window legitimately does not contain the new post. Removing optimistic entries on any refetch makes the user watch their own post vanish and reappear.

**The ID swap must carry the measured height across.** The optimistic entry is keyed by `draftId`; the real post arrives with a server-generated UUIDv7 the client cannot predict (`post-service.md` §3 generates it in-process). The virtualiser keys items by post ID ([`feature-modules.md`](./feature-modules.md) `timeline`), so replacement changes the key, discards the cached measurement, and the list re-measures — visibly shifting content directly under the user who just posted.

```ts
function replaceOptimistic(draftId: string, real: Post) {
  heightCache.rename(draftId, real.id); // carry the measurement across the key change
  swapInTimelinePages(draftId, real);
}
```

This is the seam between two independently reasonable designs — optimistic-by-draft-ID and virtualise-by-post-ID — and it only misbehaves at the moment of a successful publish, which is the moment the user is watching most closely.

Failed entries are **kept** in a failed state with an inline retry, never silently dropped — the draft and its idempotency key are still in `localStorage`, so retry is safe.

---

## 5. Count reconciliation

The mechanism behind ADR FE-0007, and the least obvious thing in the frontend.

### The problem

The backend guarantees different consistency for two fields on the same object (system design §6):

| Field        | Guarantee                                                                               |
| ------------ | --------------------------------------------------------------------------------------- |
| `liked`      | **Read-your-writes** — the `likes` row is the source of truth, returned in the response |
| `like_count` | **Eventually consistent**, ~10 s lag, explicitly approximate                            |

A naive optimistic `count + 1` then breaks on the next refetch inside the lag window: the server returns the old count, the number drops back, and every like looks like it failed.

### The design

Never write the count optimistically. Hold a **delta** beside it and render the sum.

```ts
// data/optimistic/counts.ts
type Delta = { value: number; appliedAt: number; baseline: number };

const deltas = new Map<string, Delta>(); // key: `${postId}:${counter}`

export function setCountDelta(id: string, counter: Counter, d: number) {
  const baseline = readServerCount(id, counter);
  deltas.set(`${id}:${counter}`, { value: d, appliedAt: Date.now(), baseline });
}

export function displayCount(id: string, counter: Counter): number {
  const server = readServerCount(id, counter);
  const delta = deltas.get(`${id}:${counter}`);
  if (!delta) return server;

  // The server has caught up — its value moved in the expected direction.
  if (Math.sign(server - delta.baseline) === Math.sign(delta.value)) {
    deltas.delete(`${id}:${counter}`);
    return server;
  }

  // Ceiling: never hold a delta forever, even if the server never moves
  // (someone else may have unliked in the same window, netting to zero).
  if (Date.now() - delta.appliedAt > 15_000) {
    deltas.delete(`${id}:${counter}`);
    return server;
  }

  return Math.max(0, server + delta.value);
}
```

Three properties:

- **Monotonic display.** The visible number never jumps backwards while the user is looking at it.
- **Self-healing.** Deltas clear when the server catches up, or at a 15-second ceiling. Nothing accumulates.
- **Bounded.** `Math.max(0, …)` guards against a negative display if the server value drops for an unrelated reason.

Applies to `like_count`, `repost_count`, `reply_count`, `follower_count`, and the notification unread badge — every counter the backend describes as approximate.

**Tested against a mock that deliberately returns stale counts**, because that is exactly what the real backend does and it is invisible in a naive mock.

---

## 6. Realtime → cache bridge

`realtime/` never touches the query cache directly. It emits typed events; `data/` owns the merge.

```ts
export function onNotification(n: Notification) {
  if (seen.has(n.id)) return; // at-least-once ⇒ dedupe
  seen.add(n.id);

  queryClient.setQueryData(keys.notifications(), prependPage(n));
  setCountDelta('unread', 'notifications', +1); // same reconciliation as §5
}
```

One merge function serves both the socket and the 60-second poll fallback (FE-0010). That makes duplicate handling uniform and guarantees the fallback path cannot drift from the primary one.

---

## 7. Persistence

```ts
persistQueryClient({
  queryClient,
  persister: createIDBPersister('social-cache'),
  maxAge: 24 * 60 * 60_000,
  buster: `${APP_VERSION}:${userId}`, // ← both, deliberately
  dehydrateOptions: {
    shouldDehydrateQuery: (q) =>
      // ONLY the home timeline and the current user — not every timeline ever viewed
      isKey(q.queryKey, keys.timelineHome()) || isKey(q.queryKey, keys.me),
  },
});
```

Persisted: the home timeline and the current user. **Not** persisted: other users' timelines, viewed profiles, notifications (arrive by push), search results (transient), session (must be re-established).

> An earlier draft persisted every key prefixed `timeline` and `user`. A user who browses 50 profiles in a session would then write 50 timelines and 50 profiles to IndexedDB, none of which is ever read on boot — the boot path only renders the home timeline. Unbounded storage growth for zero benefit. Persistence exists to make _one_ screen fast (FE-0014); persisting more than that screen needs is pure cost.

`buster` includes the user ID so a different user on a shared device cannot see the previous user's cache — a hard requirement, tested explicitly (FE-0014). The cache is also cleared on logout ([`03-flows.md`](../03-flows.md) §11).

---

## 8. Query/mutation inventory

| Hook                                  | Endpoint                          | Notes                            |
| ------------------------------------- | --------------------------------- | -------------------------------- |
| `useSession`                          | `POST /v1/auth/refresh`           | Boot; `staleTime: Infinity`      |
| `useMe`                               | `GET /v1/users/me`                |                                  |
| `useHomeTimeline`                     | `GET /v1/timelines/home`          | Infinite, `maxPages: 10`         |
| `useUserTimeline`                     | `GET /v1/timelines/user/{id}`     | Infinite                         |
| `usePost` / `useThread`               | `GET /v1/posts/{id}` · `/replies` |                                  |
| `useUser` / `useUserByUsername`       | `GET /v1/users/…`                 | Two keys, one entity — see below |
| `useFollowers` / `useFollowing`       | `GET /v1/users/{id}/…`            | Infinite                         |
| `useNotifications` / `useUnreadCount` | `GET /v1/notifications…`          | WS-updated                       |
| `useSearchPosts` / `useSearchUsers`   | `GET /v1/search/…`                | Debounced 300 ms                 |
| `useTrending`                         | `GET /v1/trending/hashtags`       | 5 min                            |
| `useCreatePost` / `useDeletePost`     | `POST` / `DELETE /v1/posts`       | Idempotency key                  |
| `useLike` / `useRepost`               | `PUT`/`DELETE`                    | Optimistic + delta               |
| `useFollow` / `useBlock` / `useMute`  | `PUT`/`DELETE`                    | Optimistic + delta               |
| `useMarkNotificationsRead`            | `POST /v1/notifications/read`     | Optimistic                       |

**`useUser` and `useUserByUsername` are two keys for one entity.** Public profile routes resolve by username while everything else resolves by ID. On username resolution the result is written into _both_ keys, so a subsequent ID-keyed read is an instant cache hit rather than a duplicate request. Without that, every profile visit from a public link fetches the same user twice.

---

## 9. Testing

- **Unit:** count reconciliation across the full matrix (server catches up / server stale / ceiling reached / negative guard); cursor accumulation and `maxPages` eviction; cache-key hierarchy invalidation.
- **Integration (MSW):** optimistic like rolled back on 500 across _all_ cached copies; optimistic post surviving a refetch inside the 5 s fan-out window; duplicate WS notification ignored; persisted cache busted on user change.
- **The stale-counter test is mandatory** — a mock that returns updated counts immediately hides the entire class of bug §5 exists to solve.
