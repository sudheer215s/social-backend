# Module — `features/*`

Screens and domain components. One directory per feature; no cross-feature imports (share via `ui/` or `data/`).

```
features/{timeline,composer,post,profile,notifications,search,auth}/
├── components/     domain components
├── hooks/          feature-scoped logic
└── index.ts        public surface — the only thing routes may import
```

The `index.ts` barrier is what makes features refactorable: `app/` imports a screen, not the internals, so a feature can be restructured without touching routing.

---

## `timeline`

The screen that is 65% of traffic. Everything else can be ordinary; this cannot.

**Components:** `TimelineList`, `TimelineItem`, `NewPostsPill`, `TimelineSkeleton`, `DegradedBanner`

### Virtualisation + infinite query + scroll restoration

The hardest interaction in the app (risk FR3). Three mechanisms that fight each other:

```ts
const virtualizer = useWindowVirtualizer({
  count: posts.length,
  estimateSize: () => 180,
  overscan: 5,
  getItemKey: (i) => posts[i]!.id, // ← by ID, never by index
  measureElement: (el) => heightCache.set(el.dataset.postId!, el.offsetHeight),
});
```

| Decision                                      | Reason                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getItemKey` by post ID                       | Index keys break when a page is prepended — every item remeasures and the scroll jumps           |
| Heights cached by post ID in `sessionStorage` | Restoration needs real heights _before_ scrolling, or the estimate lands the user somewhere else |
| Prefetch at 70% of loaded height              | Waiting for the sentinel means a visible loading state on every page over 4G                     |
| `overscan: 5`                                 | Enough to avoid blank frames on fast flicks; more costs INP                                      |

**Restoration order is load-bearing:** hydrate cache → restore measured heights → set scroll offset → render. Any other order produces a visible jump.

### The "new posts" pill

The backend guarantees new posts appear only on a fresh page 1 (`timeline-service.md` §4), so nothing may be injected into a scrolled list.

```
poll GET /v1/timelines/home?limit=1 every 60s while visible
  → head id ≠ known head → show "N new posts"
  → tap → reset the infinite query to page 1 + scroll to top
```

Auto-prepending would move content under the user's thumb mid-read. The pill is the only correct affordance, and it is also what the backend's cursor stability was designed to enable.

### Degradation

`X-Degraded` from the response is rendered as a dismissible banner naming what is stale — `timeline-pull` → "Some posts may be missing"; `post-hydration` → "Some posts couldn't be loaded". Never a blocking error: a degraded timeline is still a usable timeline.

---

## `composer`

Owns drafts, idempotency, and optimistic publish. Full flow in [`03-flows.md`](../03-flows.md) §6.

**Components:** `Composer`, `ComposerModal`, `CharacterCounter`, `ReplyContext`, `DraftRestorePrompt`

### Draft store

```ts
type Draft = {
  id: string;
  userId: string; // scoping — see below
  idempotencyKey: string; // created WITH the draft — FE-0009
  text: string;
  replyToId?: string;
  createdAt: number;
  status: 'editing' | 'publishing' | 'failed';
};
```

Persisted to `localStorage` under `draft:{userId}:{draftId}` on every keystroke (debounced 300 ms) and restored on boot.

**Drafts are scoped by user ID and survive logout** — deliberately, so a session expiring mid-compose does not destroy the user's writing. That combination only works if the scoping is real: restoring drafts by `draftId` alone would show user A's unfinished post to user B on a shared device. On boot, only drafts matching the current user ID are restored; others remain untouched on disk and are swept after 30 days. The idempotency key is created when the draft is created and survives reload, crash, and auth failure — so a retry after any of those is still the _same_ intent to the backend, not a new one.

### Character counting

```ts
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const length = [...segmenter.segment(text)].length;
```

The backend counts graphemes (`post-service.md` §3). `"👨‍👩‍👧‍👦".length` is 11 in JavaScript and 1 to a user. Using `.length` produces a counter that disagrees with the server in both directions — rejecting text that fits, accepting text that will 422.

The counter warns at 260 and blocks at 280, matching the server's limit exactly so validation never surprises.

### Publish

Optimistic insert at the feed head, then reconciliation **by ID** — not removal on refetch. Fan-out takes up to 5 s (system design §1), so a refetch inside that window legitimately does not contain the post; removing optimistic entries on refetch makes users watch their own post vanish and reappear.

Failure keeps the entry in a `failed` state with inline retry, and keeps the draft with its original key. Nothing the user typed is ever discarded by the system.

---

## `post`

**Components:** `PostCard`, `PostActions`, `PostDetail`, `Thread`, `ReplyList`, `PostMenu`, `DeletedPostTombstone`

`PostCard` is the most-rendered component in the app. Rules: memoised, no inline object or function props, relative timestamps updated by **one shared interval** rather than a timer per card (100 cards × 1 timer = 100 wakeups/second, a measurable battery and INP cost).

### Actions

Like and repost use the optimistic-boolean + count-delta pattern ([`data-layer.md`](./data-layer.md) §5). Rapid toggling is debounced to the final state.

### Tombstones

Deleted posts, blocked authors, and suspended accounts all arrive as tombstones from hydration (`timeline-service.md` §7). One `DeletedPostTombstone` renders all cases with identical copy — "This post is unavailable". Distinguishing them would leak exactly what the backend's 404-not-403 policy conceals.

---

## `profile`

**Components:** `ProfileHeader`, `FollowButton`, `ProfileTabs`, `FollowerList`, `PrivateAccountNotice`

### Server-rendered, client-overlaid

Public profile routes are SSR (FE-0001) and render **without viewer context** — no follow state, no block state. On mount, an authenticated viewer's relationship state is fetched and overlaid.

The initial render therefore shows a **neutral, loading** follow control — never a wrong one. Showing "Follow" to someone who already follows is worse than 200 ms of skeleton, because the user acts on it.

### `FollowButton` — three states, not two

```
not following  → "Follow"
requested      → "Requested"     (private account, awaiting approval)
following      → "Following"     (hover/focus → "Unfollow", with confirm on mobile)
```

Optimistic transition targets the _correct_ state: for a known-private account it goes to "Requested", not "Following" (`graph-service.md` §3). Optimistically claiming a follow that is actually pending is a visible lie that corrects itself a moment later.

A `404` from follow means blocked, and renders as generic not-found — never "you have been blocked".

---

## `notifications`

**Components:** `NotificationList`, `NotificationItem`, `UnreadBadge`, `NotificationGroup`

### Aggregated notifications

The backend aggregates ("Alice, Bob and 47 others liked your post") with `actor_ids` capped at 8 and `actor_count` unbounded (`notification-service.md` §2). The UI renders up to 3 avatars, names the first 2, and shows "and N others" using `actor_count` — **not** `actor_ids.length`, which is capped at 8 and would render "and 6 others" for 50 likers.

### Read state

Marking read is optimistic with rollback. The unread badge uses the same count-delta reconciliation as likes — the server value is the source, the local delta is a display overlay.

Items whose entity has been deleted are filtered server-side at read time (`notification-service.md` §6), so the client renders whatever it receives without additional filtering.

---

## `search`

**Components:** `SearchInput`, `SearchTabs`, `TrendingList`, `SearchResults`, `SearchDegradedNotice`

Debounced 300 ms, minimum 2 characters, in-flight requests cancelled on new input. The backend's search limit is 30/min per user (`api-gateway.md` §4); a per-keystroke implementation exhausts that in twelve seconds of typing.

`degraded: true` renders `SearchDegradedNotice`, never `EmptyState` — "temporarily limited", not "no results". These mean opposite things and look identical if conflated.

Trending is shown when the query is empty, cached 5 minutes to match the server's recomputation cadence (`search-service.md` §5).

---

## `auth`

**Components:** `LoginForm`, `RegisterForm`, `VerifyEmailBanner`, `PasswordResetForm`, `SessionBoundary`, `UnverifiedGate`

### Anti-enumeration is a frontend responsibility

The backend returns byte-identical responses for unknown-email and wrong-password (`identity-service.md` §4.2). The client must not undo that: one form-level message for both, no client-side email-existence check, no differing field placement. Password reset always shows "If an account exists for that address, we've sent a link."

### `UnverifiedGate`

Unverified users may read but not post, follow, or like (`identity-service.md` §4.1). This is a **normal state**, not an error — users occupy it for minutes or days.

```tsx
<UnverifiedGate action="post">
  <Composer />
</UnverifiedGate>
```

Renders children when verified; otherwise renders the control disabled with the reason attached and a resend affordance. A persistent, dismissible banner sits in the app shell. Treating this as an error case produces a hostile first run.

### `SessionBoundary`

Guards authenticated routes against the session state machine ([`03-flows.md`](../03-flows.md) §1). Renders nothing in `unknown`, a skeleton in `bootstrapping`, and redirects to `/login?next=` in `anonymous` — preserving the destination so login returns the user where they were going.

---

## Cross-feature rules

| Rule                                                          | Reason                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| No cross-feature imports                                      | Share via `ui/` or `data/`; otherwise the graph becomes a ball of mud |
| Features never call `api-client`                              | All server access through `data/` hooks                               |
| Every feature exports through `index.ts`                      | Routes import screens, not internals                                  |
| Every list has empty, loading, error, and **degraded** states | Four states, not two; the fourth is the one that gets forgotten       |
| Every feature has an error boundary                           | Failures degrade a region, not the page                               |

The fourth row is the recurring theme of this architecture. The backend distinguishes "nothing here" from "we could not check"; every list in the frontend has to preserve that distinction or the effort is wasted at the last mile.
