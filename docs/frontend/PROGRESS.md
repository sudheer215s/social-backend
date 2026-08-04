# Frontend Progress Memory

**Last updated:** 2026-08-04
**Branch:** `feature/frontend-implementation`

## Status

Phase F1 (Auth + shell) complete against MSW. Phase F2 timeline read path is
almost closed: data layer through virtualised feed with height cache by post
ID. Remaining: scroll restoration (F2-T06).
235 unit/integration tests green; `typecheck`, `lint`, `build` clean.

### Done

| ID         | Summary                    | Notes                                                         |
| ---------- | -------------------------- | ------------------------------------------------------------- |
| F0-T01–T09 | Foundation complete        | Next.js, tokens, ESLint, OpenAPI, api-client, MSW, UI seed    |
| F1-T01     | Session machine + boundary | Pure reducer + Zustand + boot silent refresh                  |
| F1-T02     | Login / register forms     | RHF+Zod; mapAuthError anti-enumeration                        |
| F1-T03     | RequireAuth + `?next=`     | Open-redirect safe; `/login?next=` on anonymous app routes    |
| F1-T04     | Logout + UnverifiedGate    | Fire-and-forget logout; verify banner; app shell nav          |
| F1-T05a    | Password/verify data layer | Enumeration-safe forgot; `mapTokenActionError`                |
| F1-T05b    | Forgot-password UI         | `/forgot-password`; unconditional acknowledgement             |
| F1-T05c    | Reset-password UI          | `/reset-password?token=`; missing token = expired token       |
| F1-T05d    | Verify-email UI + MSW      | `/verify-email?token=`; invalidates `me` so gates unlock      |
| F2-T01     | `useHomeTimeline` + mock   | Opaque cursors; `maxPages: 10`; 250-post MSW feed             |
| F2-T02     | `PostCard` + tombstone     | Memoised; one shared 60 s ticker for N cards                  |
| F2-T03     | `TimelineList` + degraded  | Skeletons match layout; `X-Degraded` names what is stale      |
| F2-T04     | Prefetch + new-posts pill  | Sentinel at 70%; head polled on its own key, never merged     |
| F2-T05     | VirtualTimeline + heights  | `getItemKey` by ID; sessionStorage height cache; windowed DOM |

### Active next

- F2-T06 scroll restoration on back-navigation

### Blockers / backend asks

- **No resend-verification endpoint** in the OpenAPI spec — the banner cannot
  offer "resend" until the backend adds one. Frontend did not invent a route.
- F1 exit criteria that need the **real** backend are still open: register →
  verify → login → refresh → logout, two-context single refresh, reuse
  detection copy, httpOnly refresh cookie (FE finding F1).

### Run

```bash
pnpm --filter @social/web dev        # http://localhost:3100
pnpm --filter @social/web test
pnpm --filter @social/web typecheck
pnpm --filter @social/web build
```

### Decisions while building

- Package name `@social/web`; workspace entry is `web`.
- Dev port **3100** (gateway is `:3000`).
- Layer boundaries: features → data → api-client; ban global `fetch` outside api-client.
- On 401 clear access token before refresh so post-lock re-check only succeeds for a _new_ token.
- Request deadlines use `Promise.race` (jsdom/MSW AbortSignal compatibility).
- `safeNextPath` rejects `//`, absolute URLs, and `://` embedded paths.
- Logout always clears local tokens even if `POST /logout` fails.
- Unverified is a normal UI state (gate + banner), not an error boundary.
- Forgot-password swallows every account-dependent status (400/404/422) in the
  **data layer**, so no form can accidentally branch on account existence.
  Only 429 and 5xx/network — which are account-independent — reach the UI.
- A missing `?token=` renders the same dead end as a rejected token; the user
  never types a password they are about to lose.
- Reset clears local tokens on success (backend revokes all sessions) and
  leaves them untouched on failure.
- Verification tokens are single-use: `VerifyEmailPanel` fires once per mount
  (ref guard) and only offers retry for failures that did not consume it.
- Verify success invalidates `queryKeys.me`, which is what unlocks
  `UnverifiedGate` and hides the banner without a reload.
- Cursors stay opaque: only the MSW handler ever decodes one, and the data layer
  passes `next_cursor` back verbatim.
- `request()` forwards a caller `AbortSignal` only when the fetch realm accepts
  it (probed with `new Request`), otherwise races the `abort` event — React
  Query's signal is jsdom's and undici rejects it outright.
- A degraded response is not an error: the banner appears _beside_ the posts the
  server did return, and dismissal is per-scope so a new scope re-shows it.
- Tombstoned posts (deleted / blocked author / suspended) render identical copy;
  the reason is deliberately not modelled, since telling them apart leaks what
  the 404-not-403 rule conceals.
- `PostCard` is memoised and takes no inline object/function props; relative
  timestamps come from one module-level 60 s interval shared by every card.
- The prefetch sentinel sits _inside_ the list at 70%, so the next page is in
  flight while ~6 posts are still unread; "Load more" remains as the fallback
  where `IntersectionObserver` is missing.
- The new-posts poll lives on `['timeline','home','head']` — a separate key, so
  a background fetch can never splice posts into the list being read. The count
  is the index of the current top post in the fresh head page, capped at one
  page ("20+") when that post has fallen off it.
- The pill reloads only on an explicit tap, and scrolls to top _before_
  resetting the query so the reader lands somewhere they recognise.
- Virtualisation uses TanStack Virtual with `getItemKey` by post ID and
  measured heights persisted in `sessionStorage` (LRU-ish trim at 400 entries).
  Estimates fill in until a card is measured; prepends do not wipe prior heights.
