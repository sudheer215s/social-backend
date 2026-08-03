# Frontend Architecture Decision Records

Same convention as [`docs/01-architecture/decisions.md`](../01-architecture/decisions.md): one decision, the alternatives genuinely considered, and what would make us revisit. Prefixed `FE-` to avoid collision with backend ADRs.

| ADR                 | Decision                                                             | Status   |
| ------------------- | -------------------------------------------------------------------- | -------- |
| [FE-0001](#fe-0001) | Next.js App Router, with a hard public/authenticated rendering split | Accepted |
| [FE-0002](#fe-0002) | API types generated from OpenAPI; drift fails CI                     | Accepted |
| [FE-0003](#fe-0003) | TanStack Query owns all server state                                 | Accepted |
| [FE-0004](#fe-0004) | Zustand for client state; no Redux                                   | Accepted |
| [FE-0005](#fe-0005) | Access token in memory; refresh token in an httpOnly cookie          | Accepted |
| [FE-0006](#fe-0006) | Tailwind + Radix, no component library                               | Accepted |
| [FE-0007](#fe-0007) | Optimistic writes with count-delta reconciliation                    | Accepted |
| [FE-0008](#fe-0008) | Virtualised timeline                                                 | Accepted |
| [FE-0009](#fe-0009) | Idempotency keys scoped to user intent, persisted with the draft     | Accepted |
| [FE-0010](#fe-0010) | WebSocket as an enhancement; polling is the floor                    | Accepted |
| [FE-0011](#fe-0011) | MSW as the single mock layer, derived from OpenAPI                   | Accepted |
| [FE-0012](#fe-0012) | OpenTelemetry + Web Vitals, correlated with backend traces           | Accepted |
| [FE-0013](#fe-0013) | Feature-sliced layering enforced by lint                             | Accepted |
| [FE-0014](#fe-0014) | Persisted query cache to compensate for no authenticated SSR         | Accepted |

---

## FE-0001

### Next.js App Router, with a hard public/authenticated rendering split

**Status:** Accepted · **re-reviewed and confirmed 2026-07-31** ([`00-stack-review.md`](./00-stack-review.md))

**Context.** The product has two very different surfaces. Public profiles and individual posts need SEO and fast share previews — they are the growth surface. The authenticated app is interactive, real-time, and personalised, and cannot be cached or server-rendered without holding the user's token on a server.

**Decision.** Next.js 15 App Router, with the rule from [`01-architecture.md`](./01-architecture.md) §5: **public content is SSR and unauthenticated; authenticated content is client-rendered and talks directly to `api-gateway`.**

**Alternatives.**

- _Vite SPA._ Simpler, smaller, no server to operate — and genuinely tempting, since the authenticated app is 100% client-rendered anyway. Rejected because the public surface would need a separate prerendering solution, and share previews and organic discovery matter too much to bolt on later.
- _Remix._ Excellent nested-route data loading and error boundaries. Its main strength is server-side loaders with session cookies — precisely the model FE-0005 rejects, so we would be paying for a capability we deliberately do not use.
- _Next.js with authenticated SSR._ Would require the access token in a cookie readable by the Next server, adding a second trust boundary, a CSRF surface, and a second place authorization can be wrong — in front of an `api-gateway` that is already a BFF.

**Consequences.** No server-rendered feed, so `/home` first paint is a skeleton. Mitigated by FE-0014. We also carry a Node server for the public routes; it holds no secrets and no user state.

**Deployment:** a container near the cluster rather than a managed platform. Finding F3's fix requires the gateway to recognise the SSR origin as a trusted upstream for rate-limit keying, which is simpler with a stable network identity.

### Re-review, 2026-07-31

Challenged directly, because ~90% of the app is client-rendered under either option — Next.js's headline capability is unavailable to us for almost the entire product (FE-0005 keeps the access token in memory, so the server cannot make authenticated calls).

**Confirmed.** The decisive point is that the Vite alternative does not actually avoid running a server: share previews require server-rendered `<meta>` tags, so an SPA still needs an edge function to inject them — a bespoke, undocumented server doing a worse job than a documented one. Once a server is required either way, Next.js's costs are already paid for.

Full evaluation, including the weighted comparison and the treatment of finding F3, in [`00-stack-review.md`](./00-stack-review.md).

**Revisit if** the public surface is dropped (→ Vite SPA), operating a Node runtime proves burdensome for a solo maintainer, the backend rejects F3 with no alternative, or TanStack Start matures.

---

## FE-0002

### API types generated from OpenAPI; drift fails CI

**Status:** Accepted

**Context.** The backend commits an OpenAPI spec and diffs it in CI (`api-conventions.md` §10). Hand-written client types would silently drift from it.

**Decision.** `openapi-typescript` generates `api-client/generated/` from the committed spec. Generated code is never hand-edited. CI regenerates and fails on any diff.

**Why this is the frontend's `buf breaking`.** The backend prevents contract breakage between services with a machine check. The client is just another consumer of that contract and deserves the same protection. A renamed field currently surfaces as `undefined` at runtime, in production, on the screen — the exact failure mode a type system exists to prevent.

**Alternatives.**

- _Hand-written types._ Drift is guaranteed; the only question is when it is noticed.
- _A generated SDK with a runtime_ (openapi-fetch's heavier cousins, Orval with clients). Adds kilobytes and an abstraction between us and the auth/idempotency/degradation logic that has to live in `api-client` anyway.
- _tRPC._ Would be excellent — and is unavailable, because the backend is a language-agnostic REST gateway serving future native clients too.

**Consequences.** The frontend depends on the backend's spec being accurate. Since the same spec generates our MSW mocks (FE-0011), a spec that lies makes tests fail rather than production fail.

---

## FE-0003

### TanStack Query owns all server state

**Status:** Accepted

**Decision.** Every piece of server-derived data lives in the TanStack Query cache. No server data in Zustand, no server data in component state.

**Why it fits this backend specifically:**

| Backend property                            | TanStack Query feature                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| `{data, page:{next_cursor, has_more}}`      | `useInfiniteQuery` with `getNextPageParam` maps 1:1            |
| Approximate counters                        | `setQueryData` for optimistic overlays with structural sharing |
| Read-your-writes booleans                   | Mutation `onMutate`/`onError` rollback                         |
| Eventual timeline freshness                 | `staleTime` per query type, tuned to the backend's own SLOs    |
| Duplicate requests from parallel components | Automatic request deduplication                                |
| At-least-once WS events                     | Cache is a merge target, so duplicates are idempotent          |

`staleTime` values are derived directly from the backend's consistency table rather than guessed: timeline 30 s, profile 5 min, counters 10 s (matching their stated lag), search 0 (always fresh).

**Alternatives.**

- _SWR._ Lighter, and would work. TanStack Query's mutation lifecycle and infinite-query ergonomics are materially better for the optimistic work in FE-0007, which is the hard part here.
- _RTK Query._ Requires Redux, which FE-0004 rejects.
- _Hand-rolled._ We would rebuild caching, deduplication, and retry — badly.

**Consequences.** One library owns a lot. Its cache-key discipline becomes load-bearing, so `data/keys.ts` is the single registry and ad-hoc key literals are a lint error.

---

## FE-0004

### Zustand for client state; no Redux

**Status:** Accepted

**Decision.** Small, purpose-scoped Zustand stores for genuinely client-owned state only: composer draft, UI state, realtime connection status.

**Rationale.** Once FE-0003 takes server state, what remains is small. Redux's value is disciplined state transitions across a large shared store; we do not have one, and adopting it would invite server data to leak back in — the failure mode it is meant to prevent.

**Alternatives.** _Redux Toolkit_ — ceremony without a matching problem. _Context + useReducer_ — re-render granularity is poor for the composer, which updates per keystroke. _Jotai/Recoil_ — atomic model is fine but adds a second mental model alongside the query cache.

**Consequences.** Multiple small stores rather than one tree. Store boundaries are enforced by review: a store holding data that came from the server is a bug.

---

## FE-0005

### Access token in memory; refresh token in an httpOnly cookie

**Status:** Accepted · **depends on backend change, see [`06-review.md`](./06-review.md) F1**

**Context.** The backend issues 10-minute access tokens and 30-day rotating refresh tokens with reuse detection (`identity-service.md` §3). Reuse detection is the control that makes theft _detectable_ — and it only works if the attacker and the legitimate client cannot both hold a usable token.

**Decision.**

- **Access token:** a module-private variable in `api-client`. Never `localStorage`, never `sessionStorage`, never a store, never persisted.
- **Refresh token:** an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/v1/auth/refresh`, set by the gateway. JavaScript never sees it.
- **Boot:** the app always attempts a silent refresh on load, because the access token does not survive a reload.

**Why anything else is wrong here.** Storing a refresh token where JavaScript can read it means an XSS steals a 30-day credential. Worse, it defeats reuse detection itself: the attacker refreshes, the user refreshes, the family is revoked, and the _user_ is logged out while the attacker simply repeats the process. A rotating refresh token in `localStorage` is barely better than a non-rotating one.

**Alternatives.**

- _Both tokens in memory._ Most secure; forces re-login on every reload. Unacceptable UX.
- _Access token in `localStorage`._ Convenient, XSS-readable, and survives in browser storage after logout. No.
- _Both in httpOnly cookies._ Then every API request is cookie-authenticated and needs CSRF defence across the whole surface. Bearer tokens for the API and a cookie for the single refresh endpoint confines the CSRF surface to one endpoint with `SameSite=Strict`.

**Consequences.** A ~150 ms boot refresh before the first authenticated request. Native clients continue to use the request-body form, so the backend must support both — which is the additive change F1 requests.

---

## FE-0006

### Tailwind + Radix primitives, no component library

**Status:** Accepted

**Decision.** Tailwind CSS for styling, Radix UI for behavioural primitives (dialog, popover, menu, tabs, toast), CVA for variants. Our own thin `ui/` layer on top.

**Rationale.** Radix supplies the parts that are genuinely hard and genuinely important: focus trapping, focus restoration, ARIA wiring, keyboard interaction, dismissal semantics. Those are where hand-rolled components fail accessibility. It supplies no styles, so it costs nothing in visual lock-in and very little in bundle size.

**Start from shadcn/ui.** shadcn/ui _is_ Radix + Tailwind + CVA, already assembled and delivered by copy-paste into your own repo. An earlier draft set it aside in favour of hand-building ~22 primitives, on an ownership argument that does not survive scrutiny: shadcn/ui components become your source code the moment you add them — no runtime dependency, no version to upgrade, fully editable. Hand-building the same thing costs roughly a week and produces no differentiation.

Use it as a starting point, then delete and edit freely. Every constraint below still applies: our token system, the 44px tap target, contrast tests, axe per story, and a deliberately small inventory. shadcn/ui is a floor, not a library to accumulate — a feed app needs perhaps 20 primitives, not 60.

**Alternatives.**

- _MUI / Chakra / Ant._ Large bundles against a 180 KB budget, and every product-specific design decision becomes a fight with the theme system.
- _Hand-build on raw Radix._ What this ADR originally specified. Same result, a week slower.
- _CSS Modules / vanilla-extract._ Fine, but Tailwind's constraint-by-default is what keeps a design system consistent when several people touch it.

**Consequences.** We own our components, including their accessibility beyond what Radix provides — shadcn/ui's defaults are good but not audited by us. Every `ui/` primitive ships with an axe test regardless of where it came from.

---

## FE-0007

### Optimistic writes with count-delta reconciliation

**Status:** Accepted

**Context.** The backend's consistency model (system design §6) says the `liked` boolean is **read-your-writes** while `like_count` is **eventually consistent and approximate**, lagging up to ~10 s.

The naive optimistic update breaks visibly: increment the count, then any refetch inside the lag window returns the _old_ count, and the number jumps back down in front of the user. Every like looks like it failed.

**Decision.** Treat the two fields differently, because the backend does:

- **Booleans** (`liked`, `following`, `reposted`) — optimistically flipped, rolled back on error. They are authoritative.
- **Counts** — never written optimistically. Instead a **delta overlay** is held alongside the server value: display `serverCount + delta`. The delta is cleared once the server value moves in the expected direction, or after a 15-second ceiling.

Full mechanism in [`data-layer.md`](./04-modules/data-layer.md) §5.

**Alternatives.**

- _Optimistic count, no reconciliation._ The flicker described above. This is what most implementations do.
- _No optimistic updates._ A tap that takes 200 ms to respond feels broken on mobile.
- _Refetch after a delay._ Guessing the lag; wrong in both directions.

**Consequences.** More machinery than a naive `setQueryData`. It is confined to one shared helper and is directly testable against a mock that deliberately returns stale counts — which is exactly what the real backend does.

---

## FE-0008

### Virtualised timeline

**Status:** Accepted

**Decision.** TanStack Virtual for the home timeline, user timelines, and search results. Notification lists too, above 50 items.

**Rationale.** A post card is 30–60 DOM nodes. A user who scrolls five pages holds 100 posts, so 3,000–6,000 nodes, with images and relative-time tickers. On the target device that fails the INP budget and grows memory without bound.

**Alternatives.**

- _No virtualisation._ Fine to ~50 items; the feed is the one screen where users routinely exceed that.
- _`content-visibility: auto`._ Free and helps paint cost, but keeps nodes in the DOM, so memory and layout cost remain. Used _in addition_.
- _Pagination with explicit pages._ Better for memory, worse for a feed — infinite scroll is the expected interaction.

**Consequences.** Virtualisation plus infinite scroll plus scroll restoration is the hardest interaction in the app (risk FR3). Item heights are measured and cached by post ID so restoration does not depend on re-measuring. It gets a dedicated Playwright test.

---

## FE-0009

### Idempotency keys scoped to user intent, persisted with the draft

**Status:** Accepted

**Context.** The backend requires `Idempotency-Key` on `POST /v1/posts`, `/replies`, and `/repost` (`api-conventions.md` §4), and rejects reuse with a different body via 422.

**Decision.** The key is generated **when the user's intent is created** — when a draft becomes a pending publish — not when the HTTP request is made. It is stored with the draft in `localStorage` and reused for every retry of that intent, including after a reload or crash. It is discarded only on success or on explicit user cancellation.

**Why this is easy to get wrong.** A retry wrapper that generates the key per request defeats the entire mechanism: each retry looks like a new intent, and a network failure after the server committed produces duplicate posts — precisely the scenario idempotency keys exist for. The key must be as durable as the intent it identifies, which means it must outlive the process.

**Consequences.** The draft store owns the key. Tested by killing the app mid-publish and asserting the retry produces one post and an `Idempotent-Replay: true` response.

---

## FE-0010

### WebSocket as an enhancement; polling is the floor

**Status:** Accepted

**Decision.** Notifications work without WebSocket. The socket reduces latency from a 60-second poll to under a second; it is never the only path.

**Rationale.** The backend already treats realtime this way — `realtime-gateway.md` §6 states that a total failure of the component degrades notification latency, and nothing is lost because Postgres holds the record. The client mirrors that. Corporate proxies, captive portals, and battery-saver modes all break long-lived sockets, and a notification system that silently stops working under those conditions is worse than a slower one that does not.

**Consequences.** Two delivery paths to keep consistent. Both converge on the same cache-merge function, so a notification arriving by socket and the same one arriving by poll are indistinguishable downstream — which also handles the at-least-once duplicate case for free.

The socket is lazy-loaded after first paint. It is never on the critical path.

---

## FE-0011

### MSW as the single mock layer, derived from OpenAPI

**Status:** Accepted

**Decision.** Mock Service Worker handles all API mocking, at the network layer, for unit tests, component tests, Storybook, and local development. Handlers are generated from the same OpenAPI spec as the types (FE-0002) and refined by hand for behaviour.

**Rationale.** Mocking at the network layer means tests exercise the real `api-client` — its auth refresh, its idempotency, its error normalisation, its degradation detection. Mocking the client module instead would leave exactly the code most likely to be wrong untested.

It also lets us mock the backend's _awkward_ behaviours honestly: stale counters, `X-Degraded` responses, 401-then-refresh sequences, duplicate WS deliveries, 429s. Those scenarios are where the interesting bugs live, and a hand-stubbed client makes them tedious enough that nobody writes them.

**Consequences.** Handlers must be maintained against the spec. Generation keeps the shapes correct; behaviour is ours.

---

## FE-0012

### OpenTelemetry + Web Vitals, correlated with backend traces

**Status:** Accepted

**Decision.** OTel web SDK propagating `traceparent` on API calls, plus `web-vitals` for field RUM. Both export to the same collector as the backend.

**Rationale.** The backend's tracing is end-to-end from gateway through Kafka to consumers (`observability-and-slo.md` §2). Starting the trace in the browser makes "why was this slow for this user" answerable across the whole system in one view, rather than two disconnected halves.

`traceId` is already surfaced in error UI (`api-conventions.md` §2), so a user-reported problem becomes a single trace lookup.

**Consequences.** Sampling must be conservative — 1% of sessions plus 100% of sessions with an error, mirroring the backend's tail-based approach. Beacon on `visibilitychange`, never `unload`.

---

## FE-0013

### Feature-sliced layering enforced by lint

**Status:** Accepted

**Decision.** The six layers in [`01-architecture.md`](./01-architecture.md) §6, with dependencies only downward, enforced by `eslint-plugin-boundaries` — the same tool and rationale as the backend's `libs/` boundaries.

The rule that matters most: **only `api-client` may call `fetch`.** Auth refresh, idempotency, error normalisation, trace propagation, and degradation detection all live there. One stray `fetch()` in a feature silently bypasses all five, and no test will notice.

**Alternatives.** _Convention only_ — erodes within weeks, and the erosion is invisible until an incident. _Atomic design_ — organises by visual scale rather than by dependency, which is not the axis that causes rot.

---

## FE-0014

### Persisted query cache to compensate for no authenticated SSR

**Status:** Accepted

**Context.** FE-0001 gives up server-rendered authenticated content, so `/home` first paint is a skeleton — for a returning user opening the app several times a day, on the screen that is 65% of traffic.

**Decision.** Persist the timeline and session query caches to IndexedDB. On boot, hydrate from cache and render immediately, then revalidate in the background.

**Why this genuinely works here.** The backend's own consistency model says the timeline is eventually consistent with a 5-second freshness budget (system design §1). A cached timeline from 30 seconds ago is not a lie — it is within the same order of staleness the architecture already accepts and the user already experiences. We are not showing stale data where fresh data was promised.

**Alternatives.**

- _Skeleton only._ Honest, and slower on every single app open.
- _Service worker cache of API responses._ Similar benefit, much harder to invalidate correctly, and duplicates a cache we already have.
- _Authenticated SSR._ Rejected by FE-0001 and FE-0005.

**Consequences.** Cached data can outlive a logout, so the cache is **cleared on logout and on user change** — with an explicit test, because leaking a previous user's timeline into a new session on a shared device is a privacy incident. Cache is versioned and dropped wholesale when the app version changes.
