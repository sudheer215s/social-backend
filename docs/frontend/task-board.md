# Frontend Task Board

Source: [`07-roadmap.md`](./07-roadmap.md) Phase F0–F6.
Workflow: [`../05-roadmap/WORKFLOW.md`](../05-roadmap/WORKFLOW.md) — task → test → code → build → test → review → commit.

| ID     | Phase | Task                                                         | Verifiable output                                                             | Status |
| ------ | ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| F0-T01 | F0    | Scaffold `web/` Next.js 15 App Router in monorepo            | `pnpm --filter @social/web typecheck/test/build` green; landing page compiles | done   |
| F0-T02 | F0    | Tailwind + design tokens (CSS vars, light/dark)              | Token contrast unit test; `globals.css` matches design-system §2              | done   |
| F0-T03 | F0    | ESLint six-layer boundaries + ban `fetch` outside api-client | Lint fails on deliberate layer violation and stray `fetch`                    | done   |
| F0-T04 | F0    | OpenAPI → TypeScript types (`pnpm api:types`)                | Generated types from committed spec; CI-ready script                          | done   |
| F0-T05 | F0    | api-client: `ApiError` / `NetworkError` + token store        | Unit tests: expiry margin, clear, synthetic problem                           | done   |
| F0-T06 | F0    | api-client: request pipeline (deadline, retry, X-Degraded)   | Unit tests: retry policy, header side channel                                 | done   |
| F0-T07 | F0    | Single-flight refresh + cross-tab lock                       | **20 parallel 401s → exactly one refresh**                                    | done   |
| F0-T08 | F0    | MSW skeleton + trivial authenticated screen                  | Screen renders against MSW end-to-end                                         | done   |
| F0-T09 | F0    | UI kit seed (Button + Skeleton) + Storybook stub             | Components render; Storybook deferred; unit tests green                       | done   |
| F1-T01 | F1    | Session state machine + SessionBoundary                      | Every transition unit-tested                                                  | done   |
| F1-T02 | F1    | Login / register forms + auth mutations                      | Forms map problem+json; anti-enumeration copy                                 | done   |
| F1-T03 | F1    | Auth routes + ?next= guards                                  | Unauthenticated /home redirects with next preserved                           | done   |
| F1-T04 | F1    | Logout + UnverifiedGate + app shell                          | Logout clears tokens; unverified is normal state                              | done   |
| F1-T05 | F1    | Password reset + verify-email flows                          | Forgot always same copy; verify unlocks gates                                 | done   |

### F1-T05 breakdown

One commit per row. Each row is independently testable.

| ID      | Task                                                             | Verifiable output                                                                                                        | Status |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| F1-T05a | `data/session/password.ts` mutations + Zod schemas               | Unit: forgot resolves identically for 202/400/404; rethrows 429/5xx/network. Reset clears tokens. Confirm-mismatch fails | done   |
| F1-T05b | `ForgotPasswordForm` + `/forgot-password` route                  | Unit: unknown and known email render byte-identical copy; 429 renders wait copy; submit disabled while pending           | done   |
| F1-T05c | `ResetPasswordForm` + `/reset-password?token=` route             | Unit: invalid/expired token → recoverable message + link to request new; success → onSuccess (login)                     | done   |
| F1-T05d | `VerifyEmailPanel` + `/verify-email?token=` route + MSW handlers | Unit: auto-verifies on mount; verified state invalidates `me` so `UnverifiedGate` unlocks; invalid token is not an error | done   |

### F2 breakdown (timeline read path)

Sequenced from [`07-roadmap.md`](./07-roadmap.md) Phase F2 weeks 6–8. One commit per row.

| ID     | Task                                                    | Verifiable output                                                                                           | Status |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| F2-T01 | `useHomeTimeline` infinite query + MSW timeline handler | 10 pages paginated: no duplicates, no gaps; cursor passed through opaquely; `maxPages: 10` bounds the cache | done   |
| F2-T02 | `PostCard` + shared relative-time ticker + tombstone    | One interval for N cards; memoised; unavailable posts render identical tombstone copy                       | done   |
| F2-T03 | `TimelineList` + skeletons + `DegradedBanner`           | Renders pages against MSW; `X-Degraded` names what is stale; skeleton matches real layout                   | done   |
| F2-T04 | Prefetch at 70% + `NewPostsPill` polling                | Next page requested before the sentinel; new posts never auto-injected into a scrolled list                 | done   |
| F2-T05 | Virtualisation + height cache by post ID                | `getItemKey` by ID; heights cached in `sessionStorage`; no remeasure on prepend                             | todo   |
| F2-T06 | Scroll restoration on back-navigation                   | Heights restored **before** offset; exact offset after back from a post (risk FR3)                          | todo   |

## Active next

1. F2-T05 virtualisation + height cache by post ID

## Notes

- Build against MSW first; real backend is an F1 exit criterion.
- Raise backend F1 (httpOnly refresh cookie) and F3 (SSR rate limit) early — tracked separately from FE board.
- **Backend gap (raised during F1-T05):** the OpenAPI spec has no _resend verification email_ endpoint
  (`/v1/auth/verify-email` only consumes a token). The banner therefore cannot offer "resend" yet.
  Frontend will not invent the route; tracked as a backend ask.
- **api-client fix (F2-T01):** React Query hands every `queryFn` an `AbortSignal` minted by the
  environment's global, which fails undici's `instanceof` brand check under jsdom and rejected the
  request before it reached MSW. `request()` now probes the `Request`/`AbortSignal` pairing and falls
  back to a `Promise.race` on `abort` when the signal cannot cross realms — cancellation still works,
  the socket just stays open in that (test-only) case.
