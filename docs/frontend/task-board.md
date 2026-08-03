# Frontend Task Board

Source: [`07-roadmap.md`](./07-roadmap.md) Phase F0–F6.
Workflow: [`../05-roadmap/WORKFLOW.md`](../05-roadmap/WORKFLOW.md) — task → test → code → build → test → review → commit.

| ID     | Phase | Task                                                         | Verifiable output                                                             | Status |
| ------ | ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| F0-T01 | F0    | Scaffold `web/` Next.js 15 App Router in monorepo            | `pnpm --filter @social/web typecheck/test/build` green; landing page compiles | done   |
| F0-T02 | F0    | Tailwind + design tokens (CSS vars, light/dark)              | Token contrast unit test; `globals.css` matches design-system §2              | todo   |
| F0-T03 | F0    | ESLint six-layer boundaries + ban `fetch` outside api-client | Lint fails on deliberate layer violation and stray `fetch`                    | todo   |
| F0-T04 | F0    | OpenAPI → TypeScript types (`pnpm api:types`)                | Generated types from committed spec; CI-ready script                          | todo   |
| F0-T05 | F0    | api-client: `ApiError` / `NetworkError` + token store        | Unit tests: expiry margin, clear, synthetic problem                           | todo   |
| F0-T06 | F0    | api-client: request pipeline (deadline, retry, X-Degraded)   | Unit tests: retry policy, header side channel                                 | todo   |
| F0-T07 | F0    | Single-flight refresh + cross-tab lock                       | **20 parallel 401s → exactly one refresh**                                    | todo   |
| F0-T08 | F0    | MSW skeleton + trivial authenticated screen                  | Screen renders against MSW end-to-end                                         | todo   |
| F0-T09 | F0    | UI kit seed (Button + Skeleton) + Storybook stub             | Components render; axe path ready                                             | todo   |
| F1-T01 | F1    | Session state machine + SessionBoundary                      | Every transition unit-tested                                                  | todo   |

## Active next

1. F0-T02 (tokens)
2. F0-T03 → F0-T07 in order (foundation load-bearing pieces)

## Notes

- Build against MSW first; real backend is an F1 exit criterion.
- Raise backend F1 (httpOnly refresh cookie) and F3 (SSR rate limit) early — tracked separately from FE board.
