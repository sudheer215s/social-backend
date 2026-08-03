# Frontend Progress Memory

**Last updated:** 2026-08-03
**Branch:** `feature/frontend-implementation`

## Status

Phase F1 (Auth + shell) — every F1 board task is implemented against MSW.
151 unit/integration tests green; `typecheck`, `lint`, `build` clean.

### Done

| ID         | Summary                    | Notes                                                      |
| ---------- | -------------------------- | ---------------------------------------------------------- |
| F0-T01–T09 | Foundation complete        | Next.js, tokens, ESLint, OpenAPI, api-client, MSW, UI seed |
| F1-T01     | Session machine + boundary | Pure reducer + Zustand + boot silent refresh               |
| F1-T02     | Login / register forms     | RHF+Zod; mapAuthError anti-enumeration                     |
| F1-T03     | RequireAuth + `?next=`     | Open-redirect safe; `/login?next=` on anonymous app routes |
| F1-T04     | Logout + UnverifiedGate    | Fire-and-forget logout; verify banner; app shell nav       |
| F1-T05a    | Password/verify data layer | Enumeration-safe forgot; `mapTokenActionError`             |
| F1-T05b    | Forgot-password UI         | `/forgot-password`; unconditional acknowledgement          |
| F1-T05c    | Reset-password UI          | `/reset-password?token=`; missing token = expired token    |
| F1-T05d    | Verify-email UI + MSW      | `/verify-email?token=`; invalidates `me` so gates unlock   |

### Active next

- Phase F2 timeline read path (`useInfiniteQuery`, `PostCard`, skeletons)

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
