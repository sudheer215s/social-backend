# Frontend Progress Memory

**Last updated:** 2026-08-03
**Branch:** `feature/frontend-implementation`

## Status

Phase F0 (Foundation) — in progress.

### Done

| ID     | Summary                | Notes                                                           |
| ------ | ---------------------- | --------------------------------------------------------------- |
| F0-T01 | Scaffold `@social/web` | Next.js 15 App Router, Vitest, monorepo workspace, landing page |

### Active next

- F0-T02 Tailwind + design tokens
- F0-T03 ESLint layer boundaries
- F0-T04 OpenAPI types
- F0-T05–T07 api-client + single-flight refresh (F0 acceptance)

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
