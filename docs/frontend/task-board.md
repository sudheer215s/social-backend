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
| F1-T02 | F1    | Login / register forms + auth mutations                      | Forms map problem+json; anti-enumeration copy                                 | todo   |
| F1-T03 | F1    | Auth routes + ?next= guards                                  | Unauthenticated /home redirects with next preserved                           | todo   |

## Active next

1. F1-T02 (login/register forms)
2. F1-T03 (auth routes + ?next= guards)

## Notes

- Build against MSW first; real backend is an F1 exit criterion.
- Raise backend F1 (httpOnly refresh cookie) and F3 (SSR rate limit) early — tracked separately from FE board.
