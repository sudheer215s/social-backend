# Frontend Architecture

**Version:** 1.0
**Status:** Approved for implementation
**Consumes:** the `api-gateway` REST surface and `realtime-gateway` WebSocket protocol defined in [`docs/02-components/`](../02-components/)

---

## Table of contents

1. [Purpose and design point](#1-purpose-and-design-point)
2. [Goals and non-goals](#2-goals-and-non-goals)
3. [What the backend forces us to design for](#3-what-the-backend-forces-us-to-design-for)
4. [Stack](#4-stack)
5. [Rendering strategy](#5-rendering-strategy)
6. [Layered architecture](#6-layered-architecture)
7. [Routes and screens](#7-routes-and-screens)
8. [State ownership](#8-state-ownership)
9. [Repository layout](#9-repository-layout)
10. [Performance budgets](#10-performance-budgets)
11. [Failure and degradation](#11-failure-and-degradation)
12. [Risks and open questions](#12-risks-and-open-questions)

---

## 1. Purpose and design point

A web client for the social backend: authenticated feed, composition, profiles, notifications with real-time delivery, and search — plus a public, indexable surface for profiles and individual posts.

| Parameter                | Value                                | Basis                                                |
| ------------------------ | ------------------------------------ | ---------------------------------------------------- |
| Daily active users       | 200,000                              | Backend design point                                 |
| Mobile share of sessions | ~65%                                 | Typical for social; **mobile-first is not optional** |
| Median device target     | Mid-tier Android, 4G                 | The device that fails first                          |
| Sessions/user/day        | ~4                                   | Backend §1                                           |
| Requests/session         | ~15                                  | Backend §1                                           |
| Dominant interaction     | Timeline scroll                      | ~65% of all API traffic                              |
| Public/SEO surface       | Profiles, individual posts, hashtags | Share previews and organic discovery                 |

The single most important number: **timeline scroll is 65% of traffic**. Everything in this architecture — virtualisation, cache shape, prefetching, bundle splitting — is optimised for one screen. The rest of the app is allowed to be ordinary.

---

## 2. Goals and non-goals

### Goals

1. **Fast on a mid-tier Android phone on 4G**, not on a developer's laptop. Budgets in §10 are enforced in CI.
2. **Correct under the backend's actual consistency model.** Eventual consistency, approximate counters, and at-least-once delivery are design inputs, not edge cases.
3. **Never lose a user's writing.** Drafts survive reload, navigation, and network failure.
4. **Accessible by construction** — keyboard, screen reader, reduced motion. A feed is a list of articles and should behave like one.
5. **Typed end-to-end.** API types are generated from the backend's OpenAPI spec, and drift fails CI.
6. **Honest about degradation.** When the backend says `X-Degraded`, the user is told something, not shown a confidently wrong screen.

### Non-goals (v1)

| Non-goal                               | Rationale                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Native mobile apps                     | The API is client-agnostic; a React Native client can reuse `api-client` and `data-layer` later                     |
| Offline-first / full sync engine       | Backend is not designed for conflict resolution. We do optimistic writes with rollback, not offline mutation queues |
| Direct messaging UI                    | Backend non-goal                                                                                                    |
| Rich text / markdown composition       | Backend stores 280 chars of plain text (`post-service` §2)                                                          |
| Media upload UI                        | Backend has no media service yet; `media_refs` are opaque                                                           |
| Theming beyond light/dark              |                                                                                                                     |
| i18n beyond the string-extraction seam | Backend renders no user-facing text; all copy is client-side and extraction-ready                                   |

---

## 3. What the backend forces us to design for

This is the section that makes this architecture specific rather than generic. Each item is a backend decision with a mandatory frontend consequence.

| Backend behaviour                                     | Where                    | Frontend consequence                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Refresh tokens rotate with reuse detection**        | `identity-service` §3    | Two concurrent refreshes = the second presents a rotated token = **the backend revokes the entire session family and logs the user out**. Single-flight refresh, coordinated _across tabs_, is mandatory. See §6 and [`api-client.md`](./04-modules/api-client.md) |
| Access token lives 10 minutes                         | `identity-service` §3    | Silent refresh on 401, and a boot-time refresh because the token is held in memory only                                                                                                                                                                            |
| **Counters are approximate**, lag ≤ 10 s              | System design §6         | Optimistic `+1` then refetch shows the _old_ count and the number visibly jumps back. Requires a delta-overlay reconciliation strategy ([`data-layer.md`](./04-modules/data-layer.md) §5)                                                                          |
| `liked` / `following` booleans are read-your-writes   | System design §6         | The boolean is authoritative and instant; only the count is fuzzy. UI trusts the boolean, softens the count                                                                                                                                                        |
| Timeline freshness p99 5 s                            | System design §1         | A new post is not in your own timeline immediately. Prepend it locally; do not refetch and expect it                                                                                                                                                               |
| **Cursors are opaque** and ranking may be added later | ADR-0016                 | Never parse, construct, or compare a cursor. Never assume it is a post ID                                                                                                                                                                                          |
| New posts appear only on a fresh page 1               | `timeline-service` §4    | "N new posts" pill, applied on explicit user action. Never auto-inject into a scrolled list                                                                                                                                                                        |
| `Idempotency-Key` required on post creation           | `api-conventions.md` §4  | The key belongs to the **user's intent**, generated once and reused across every retry — including after an app restart                                                                                                                                            |
| `PUT`/`DELETE` for like and follow                    | `api-gateway.md` §3      | These are state assertions. Retries are free; no idempotency key needed                                                                                                                                                                                            |
| WebSocket delivery is **at-least-once**               | `realtime-gateway.md` §4 | Client dedupes by notification ID                                                                                                                                                                                                                                  |
| WS auth uses a 30 s single-use ticket                 | `realtime-gateway.md` §2 | Connection requires an HTTP call first; reconnect must re-ticket, not replay the URL                                                                                                                                                                               |
| WS closes 4403/4408 on session expiry                 | `realtime-gateway.md` §2 | Reconnect logic must distinguish "get a new ticket" from "you are logged out"                                                                                                                                                                                      |
| `X-Degraded` header on partial responses              | `api-conventions.md` §5  | Must survive the fetch layer and reach the UI. Most clients discard headers                                                                                                                                                                                        |
| Rate-limit headers on **successful** responses        | `api-conventions.md` §9  | Pace proactively rather than discovering limits via 429                                                                                                                                                                                                            |
| **404, not 403**, for private/blocked content         | `api-conventions.md` §2  | Render "not found". A distinct "private" state in the UI leaks the existence the backend deliberately hid                                                                                                                                                          |
| Errors are RFC 9457 `problem+json` with `traceId`     | `api-conventions.md` §2  | Surface the trace ID in error UI — it is the support workflow                                                                                                                                                                                                      |
| Search may return `degraded: true`                    | `search-service` §7      | "Search is temporarily limited", not "no results found"                                                                                                                                                                                                            |

> The first row is the one to internalise. A naive fetch wrapper that refreshes on 401 will, under a burst of parallel requests, silently log users out — and it will do so intermittently, under load, in a way that looks like a backend bug. It is the highest-severity frontend defect available in this system.

---

## 4. Stack

| Concern         | Choice                                                | ADR                                  |
| --------------- | ----------------------------------------------------- | ------------------------------------ |
| Framework       | **Next.js 15**, App Router                            | [FE-0001](./02-decisions.md#fe-0001) |
| Language        | TypeScript 5.7, `strict` + `noUncheckedIndexedAccess` | inherited                            |
| Server state    | **TanStack Query v5**                                 | [FE-0003](./02-decisions.md#fe-0003) |
| Client state    | **Zustand** (small, explicit stores)                  | [FE-0004](./02-decisions.md#fe-0004) |
| Styling         | **Tailwind CSS** + CVA                                | [FE-0006](./02-decisions.md#fe-0006) |
| Primitives      | **Radix UI** (headless, accessible)                   | [FE-0006](./02-decisions.md#fe-0006) |
| Forms           | React Hook Form + Zod                                 | —                                    |
| API types       | **Generated from OpenAPI** (`openapi-typescript`)     | [FE-0002](./02-decisions.md#fe-0002) |
| Virtualisation  | TanStack Virtual                                      | [FE-0008](./02-decisions.md#fe-0008) |
| Testing         | Vitest + Testing Library + **MSW** + Playwright       | [FE-0011](./02-decisions.md#fe-0011) |
| Observability   | OpenTelemetry web SDK + `web-vitals`                  | [FE-0012](./02-decisions.md#fe-0012) |
| Package manager | pnpm (existing workspace)                             | inherited                            |

Deliberately **not** used: Redux (server state belongs in a query cache, not a store), a component library like MUI (bundle cost and a theming fight), an ORM-style SDK generator that ships a runtime, `next-auth` (our token model is specific and the abstraction would fight it).

---

## 5. Rendering strategy

The central decision, and the one with the most consequences.

### The constraint

The access token is held **in memory only** (never `localStorage`, [FE-0005](./02-decisions.md#fe-0005)), and the refresh token is an `httpOnly` cookie scoped to the refresh endpoint. This means **the Next.js server cannot make authenticated API calls on the user's behalf** — it has no access token, and giving it one would mean a JS-readable token or a second trust boundary with its own CSRF surface.

That is not a limitation to work around. It is the correct outcome: the `api-gateway` is already a BFF (`api-gateway.md` §8), and routing authenticated traffic through a second server hop adds latency and a second place for authorization to be wrong.

### The rule

> **Public content is server-rendered and unauthenticated. Authenticated content is client-rendered and talks directly to the API gateway.**

| Route                     | Rendering               | Auth | Why                                           |
| ------------------------- | ----------------------- | ---- | --------------------------------------------- |
| `/` (logged out)          | Static                  | No   | Marketing/landing                             |
| `/@{username}`            | **SSR + ISR**           | No   | SEO, share previews, first-visit speed        |
| `/@{username}/p/{postId}` | **SSR + ISR**           | No   | Share previews are the primary growth surface |
| `/hashtag/{tag}`          | SSR                     | No   | SEO                                           |
| `/home`                   | **CSR** in an SSR shell | Yes  | Personalised, real-time, uncacheable          |
| `/notifications`          | CSR                     | Yes  |                                               |
| `/search`                 | CSR                     | Yes  | Interactive; `degraded` handling              |
| `/settings/*`             | CSR                     | Yes  |                                               |
| `/login`, `/register`     | Static shell + CSR      | No   |                                               |
| `/compose`                | CSR (modal-first)       | Yes  |                                               |

**Hydration overlay.** A server-rendered public profile is rendered without viewer context — no follow state, no like state, no blocked filtering. On mount, if the viewer is authenticated, the client fetches viewer state and overlays it. The initial render therefore shows neutral affordances (an un-pressed follow button in a loading state), never a _wrong_ one. Showing "Follow" to someone who already follows is a worse defect than showing a spinner for 200 ms.

**No authenticated SSR means no server-rendered feed**, so the `/home` first paint is a skeleton. This is an accepted cost, mitigated by an instant app shell, aggressive prefetch, and a persisted query cache that makes returning visits render from cache before the network responds (§10).

---

## 6. Layered architecture

Strict layering. Each layer may only depend downward. Enforced by `eslint-plugin-boundaries`, the same mechanism the backend uses for `libs/`.

```
┌──────────────────────────────────────────────────────────────┐
│  ROUTES        app/  — Next.js segments, layouts, metadata   │
│                Thin. Composition and data-fetching entry only│
├──────────────────────────────────────────────────────────────┤
│  FEATURES      features/{timeline,composer,profile,          │
│                          notifications,search,auth}          │
│                Screens, feature hooks, feature components    │
├──────────────────────────────────────────────────────────────┤
│  DATA LAYER    data/  — TanStack Query hooks, cache keys,    │
│                optimistic mutations, cursor pagination       │
├──────────────────────────────────────────────────────────────┤
│  CLIENTS       api-client/    typed fetch, auth, retries,    │
│                              idempotency, problem+json       │
│                realtime/      WS lifecycle, ticket, dedupe   │
├──────────────────────────────────────────────────────────────┤
│  UI KIT        ui/  — Radix + Tailwind primitives.           │
│                Zero app knowledge. No API types.             │
├──────────────────────────────────────────────────────────────┤
│  PLATFORM      lib/  — telemetry, storage, errors, env,      │
│                       formatting, feature flags              │
└──────────────────────────────────────────────────────────────┘
```

| Rule                                                                    | Enforcement                    |
| ----------------------------------------------------------------------- | ------------------------------ |
| `ui/` never imports API types or data hooks                             | ESLint boundary                |
| `features/` never calls `api-client` directly — always through `data/`  | ESLint boundary                |
| Cross-feature imports forbidden; share via `ui/` or `data/`             | ESLint boundary                |
| `data/` owns every cache key; no ad-hoc `queryKey` literals in features | Lint rule + code review        |
| Only `api-client` may call `fetch`                                      | ESLint `no-restricted-globals` |

The last rule is the one that matters most. Auth refresh, idempotency, error normalisation, trace propagation, and degradation detection all live in one place; a single stray `fetch()` in a feature bypasses every one of them. Making it a lint error is cheaper than catching it in review forever.

---

## 7. Routes and screens

```
app/
├── (public)/
│   ├── page.tsx                       landing (static)
│   ├── @[username]/page.tsx           profile           SSR + ISR 60s
│   ├── @[username]/p/[postId]/page.tsx post + thread    SSR + ISR 60s
│   └── hashtag/[tag]/page.tsx         hashtag           SSR
├── (auth)/
│   ├── login/ · register/ · verify/ · reset/
├── (app)/                             ← authenticated shell, client-rendered
│   ├── layout.tsx                     nav, realtime provider, auth guard
│   ├── home/page.tsx                  home timeline
│   ├── notifications/page.tsx
│   ├── search/page.tsx
│   ├── settings/{profile,account,notifications,privacy,sessions}/
│   └── compose/page.tsx               full-page fallback for the modal
├── opengraph-image.tsx                dynamic share cards
└── not-found.tsx · error.tsx · global-error.tsx
```

**Composer is a route-backed modal.** Intercepting routes render it as an overlay on top of the feed for in-app navigation, while a direct visit or reload gets a full page. This preserves feed scroll position — losing it when opening the composer is a top-tier annoyance in every social client that gets it wrong.

**`not-found.tsx` is load-bearing for privacy.** Private posts, blocked users, and deleted content all return `404` from the backend by design (`api-conventions.md` §2). The frontend renders one identical not-found screen for all of them. A distinct "this account is private" state would leak exactly the existence the backend spent effort concealing.

---

## 8. State ownership

Getting this boundary wrong is the most common cause of frontend rot. One rule: **if it came from the server, it lives in the query cache; if the user is currently manipulating it, it lives in a store.**

| State                                                          | Owner                                                                     | Persistence                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Timeline pages, posts, profiles, notifications, search results | **TanStack Query**                                                        | In-memory + `IndexedDB` persistence for the timeline |
| Auth status, current user                                      | TanStack Query (`['session']`)                                            | Memory; rehydrated by boot refresh                   |
| Access token                                                   | **Module-private variable in `api-client`**                               | Memory only — never a store, never persisted         |
| Composer draft (text, reply target, idempotency key)           | Zustand + `localStorage`                                                  | **Survives reload and crash**                        |
| UI state: modals, menus, toasts, theme                         | Zustand                                                                   | Theme persisted; rest ephemeral                      |
| Realtime connection status                                     | Zustand                                                                   | Ephemeral                                            |
| Optimistic count deltas                                        | TanStack Query cache (§ [`data-layer.md`](./04-modules/data-layer.md) §5) | Ephemeral                                            |
| Scroll position per feed                                       | `sessionStorage` via the router cache                                     | Session                                              |

The access token is deliberately **not** in a Zustand store: stores get devtools, get persisted "for convenience", and get serialised into error reports. A module-private variable with a narrow accessor cannot accidentally acquire any of those.

---

## 9. Repository layout

Added to the existing pnpm workspace. `pnpm-workspace.yaml` gains `web/*`.

```
web/
├── app/                     Next.js App Router (routes only)
├── features/
│   ├── timeline/            feed, virtualisation, new-post pill
│   ├── composer/            draft, idempotency, optimistic publish
│   ├── post/                card, actions, thread
│   ├── profile/             header, tabs, follow
│   ├── notifications/       list, grouping, unread badge
│   ├── search/              input, tabs, trending
│   └── auth/                forms, session boot, guards
├── data/
│   ├── keys.ts              the single cache-key registry
│   ├── queries/ · mutations/
│   └── optimistic/          shared rollback + count-delta helpers
├── api-client/
│   ├── client.ts            typed fetch, deadline, retry, degraded
│   ├── auth.ts              single-flight refresh, cross-tab lock
│   ├── idempotency.ts       intent-scoped keys
│   ├── errors.ts            problem+json → typed errors
│   └── generated/           openapi-typescript output — never hand-edited
├── realtime/                socket lifecycle, ticket, dedupe, cache bridge
├── ui/                      Radix + Tailwind primitives
├── lib/                     telemetry, storage, env, format, flags
├── styles/
├── e2e/                     Playwright
└── mocks/                   MSW handlers, generated from OpenAPI
```

`api-client/generated/` is produced by `pnpm api:types` from the backend's committed OpenAPI spec and is **never hand-edited**. Drift between the spec and the generated types fails CI — the frontend equivalent of the backend's `buf breaking` gate.

---

## 10. Performance budgets

Enforced in CI on a throttled mid-tier Android profile (4× CPU slowdown, 4G). A PR that exceeds a budget fails.

| Metric                    | Budget                       | Notes                                             |
| ------------------------- | ---------------------------- | ------------------------------------------------- |
| LCP (`/home`, warm cache) | < 1.8 s                      | Skeleton counts only if it is the real layout     |
| LCP (`/@user`, cold, SSR) | < 2.0 s                      | Server-rendered, so achievable                    |
| **INP**                   | **< 200 ms**                 | The metric that matters for a scroll-and-tap app  |
| CLS                       | < 0.1                        | Fixed-height skeletons; reserved media boxes      |
| TTFB (SSR routes)         | < 400 ms                     |                                                   |
| JS — initial shell        | **< 180 KB** gzip            | Route-split; composer, search, WS client all lazy |
| JS — `/home` route chunk  | < 90 KB gzip                 |                                                   |
| CSS                       | < 30 KB gzip                 | Tailwind, purged                                  |
| Timeline scroll           | 60 fps, no long task > 50 ms | Virtualisation is what buys this                  |

**Techniques that carry the budget:**

- **Virtualised timeline** (TanStack Virtual). A 400-entry feed of rich cards is thousands of DOM nodes; without virtualisation, INP and memory both fail on mid-tier devices.
- **Persisted query cache** (IndexedDB) so a returning user sees their previous feed instantly while revalidation runs. This is what compensates for having no authenticated SSR (§5).
- **Route-level code splitting** with prefetch on intent (hover/touchstart), not on render.
- **`next/font`** with `font-display: swap` and preloaded subsets.
- **Lazy realtime.** The WebSocket client is loaded after first paint — it is never on the critical path.
- **Optimistic navigation** for profile and post routes using data already in the timeline cache.

---

## 11. Failure and degradation

| Condition               | Behaviour                                                                        | Signal                              |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| Offline                 | Cached content readable; writes queue to the draft store and prompt on reconnect | Persistent offline bar              |
| API 5xx                 | Retry with backoff (idempotent only); error boundary with trace ID and retry     | Inline, scoped to the failed region |
| `X-Degraded` present    | Subtle banner naming what is stale — "Some posts may be missing"                 | Dismissible, non-blocking           |
| Search `degraded: true` | "Search is temporarily limited" — **explicitly not "no results"**                | Inline                              |
| 401 after refresh fails | Clear session, redirect to login, **preserve the draft**                         | Toast                               |
| 429                     | Disable the action, show the `Retry-After` countdown                             | Inline on the control               |
| WebSocket down          | Fall back to polling notifications every 60 s                                    | Subtle "reconnecting" dot           |
| Post publish fails      | Draft is preserved with its **original idempotency key**; retry is safe          | Retry affordance in the composer    |

Two principles behind this table:

1. **Degrade a region, not the page.** A failed notification count must not blank the feed. Error boundaries wrap features, not routes.
2. **Never show a confident wrong answer.** "No results" and "we could not search" look identical to a user and mean opposite things. The backend went to the trouble of telling us which; throwing that away is the failure.

---

## 12. Risks and open questions

| #   | Risk                                                   | Impact                                               | Mitigation                                                                                                                |
| --- | ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| FR1 | **Concurrent refresh logs users out**                  | Severe, intermittent, looks like a backend bug       | Single-flight + cross-tab Web Locks; explicit test with 20 parallel 401s and a two-tab Playwright test                    |
| FR2 | Optimistic counts fight approximate server counts      | Visible number flicker on every like                 | Delta-overlay reconciliation ([`data-layer.md`](./04-modules/data-layer.md) §5); tested against a deliberately stale mock |
| FR3 | Virtualised list + infinite query + scroll restoration | Jump-to-wrong-position on back navigation; a classic | Measured item cache keyed by post ID; explicit Playwright test                                                            |
| FR4 | No authenticated SSR → slow perceived first paint      | Bounce on `/home`                                    | Persisted cache + real-layout skeleton; measured, not assumed                                                             |
| FR5 | Draft loss                                             | Users do not forgive it                              | `localStorage` write on every keystroke (debounced), restored on boot, covered by E2E                                     |
| FR6 | Bundle creep                                           | Budgets erode silently                               | Size budgets are a CI gate, not a report                                                                                  |
| FR7 | OpenAPI drift                                          | Runtime type errors in production                    | Generated types + CI diff, MSW handlers derived from the same spec                                                        |

### Open questions

| #   | Question                                                                                                    | Default if unanswered                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FQ1 | Does the backend expose the refresh token as an `httpOnly` cookie for web clients? **Blocking for FE-0005** | Assume yes; §3 of [`security.md`](./05-cross-cutting/security.md) specifies the required change |
| FQ2 | Is there a `GET /v1/timelines/home/count?since=` for the "new posts" pill?                                  | Poll page 1 with `limit=1` and compare the head ID                                              |
| FQ3 | Does the WS protocol push timeline updates, or only notifications?                                          | Notifications only (`realtime-gateway.md` §9 item 2 lists timeline pushes as deferred)          |
| FQ4 | Are hashtag pages public/SEO or authenticated?                                                              | Public                                                                                          |
| FQ5 | Server-rendered OG images per post — cost acceptable?                                                       | Yes, with ISR caching                                                                           |

**FQ1 is a genuine blocker and should be raised with the backend now.** As specified, `POST /v1/auth/refresh` takes the refresh token in the request body (`identity-service.md` §3), which forces a web client to store it somewhere JavaScript can read — defeating the point of a rotating refresh token, because an XSS steals it and the reuse-detection mechanism can no longer distinguish attacker from user. The fix is small and additive: accept the token from an `httpOnly` cookie when present, keep the body parameter for native clients. See [`06-review.md`](./06-review.md) finding **F1**.
