# Frontend Progress Memory

**Last updated:** 2026-08-03
**Branch:** `feature/frontend-implementation`

## Status

Phase F1 (Auth + shell) — core auth path complete through logout and unverified gate.

### Done

| ID         | Summary                    | Notes                                                      |
| ---------- | -------------------------- | ---------------------------------------------------------- |
| F0-T01–T09 | Foundation complete        | Next.js, tokens, ESLint, OpenAPI, api-client, MSW, UI seed |
| F1-T01     | Session machine + boundary | Pure reducer + Zustand + boot silent refresh               |
| F1-T02     | Login / register forms     | RHF+Zod; mapAuthError anti-enumeration                     |
| F1-T03     | RequireAuth + `?next=`     | Open-redirect safe; `/login?next=` on anonymous app routes |
| F1-T04     | Logout + UnverifiedGate    | Fire-and-forget logout; verify banner; app shell nav       |

### Active next

- F1-T05 password reset + verify-email
- Phase F2 timeline

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
