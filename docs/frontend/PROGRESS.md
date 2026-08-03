# Frontend Progress Memory

**Last updated:** 2026-08-03
**Branch:** `feature/frontend-implementation`

## Status

Phase F0 (Foundation) — in progress.

### Done

| ID     | Summary                  | Notes                                                           |
| ------ | ------------------------ | --------------------------------------------------------------- |
| F0-T01 | Scaffold `@social/web`   | Next.js 15 App Router, Vitest, monorepo workspace, landing page |
| F0-T02 | Tailwind + design tokens | CSS vars light/dark; WCAG AA contrast unit tests                |
| F0-T03 | ESLint layer boundaries  | no-restricted-imports + ban fetch; assert script                |
| F0-T04 | OpenAPI → TS types       | `openapi/openapi.json` + `web/api-client/generated/schema.ts`   |
| F0-T05 | api-client errors+tokens | problem+json, synthetic errors, memory-only token store         |
| F0-T06 | request pipeline         | deadlines, retry policy, X-Degraded / RateLimit side channel    |
| F0-T07 | single-flight refresh    | **20 parallel 401s → 1 refresh**; post-lock re-check; reuse msg |

### Active next

- F0-T08 MSW + trivial authenticated screen
- F0-T09 UI kit seed

### Run

```bash
pnpm --filter @social/web dev        # http://localhost:3100
pnpm --filter @social/web test
pnpm --filter @social/web typecheck
pnpm --filter @social/web build
```

### Decisions while building

- Package name `@social/web`; workspace entry is `web` (not `web/*`) — single Next app.
- Root Nest ESLint is skipped during `next build` (`eslint.ignoreDuringBuilds`); web-specific boundaries land in F0-T03.
- Dev port **3100** to avoid clashing with api-gateway `:3000`.
- Dark-mode accent is `blue-600` (37 99 235), not blue-500 — white label text needs ≥ 4.5:1.
- Token RGB channels live in both `lib/tokens.ts` (tests) and `styles/globals.css` (runtime).
- Layer boundaries use `no-restricted-imports` + `no-restricted-globals` (eslint-plugin-boundaries v7 API was unstable for our patterns); asserted via `scripts/assert-lint-boundaries.mjs`.
- On 401 the client clears the rejected access token before `refresh()` so the post-lock re-check only succeeds when another tab installed a _new_ token.
- Network errors during refresh never clear the session; only explicit 401 on `/v1/auth/refresh` does.
