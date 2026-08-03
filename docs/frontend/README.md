# Frontend Architecture

Design documentation for the web client. Consumes the `api-gateway` REST surface and `realtime-gateway` WebSocket protocol defined in [`docs/02-components/`](../02-components/).

---

## Reading order

**New to the frontend:**

1. [`01-architecture.md`](./01-architecture.md) — stack, rendering strategy, layers, state ownership, budgets
2. [`02-decisions.md`](./02-decisions.md) — 14 ADRs: what was chosen, what was rejected, and why
3. [`03-flows.md`](./03-flows.md) — every flow that carries risk, end to end
4. The module doc for whatever you are working on

**Reviewing the design:** [`06-review.md`](./06-review.md) — 13 findings, 6 fixed, 5 needing backend changes

**Implementing:** [`07-roadmap.md`](./07-roadmap.md) — 14 weeks, 6 phases, sequenced against the backend

---

## Contents

| Document                                     |                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00-stack-review.md`](./00-stack-review.md) | **Next.js vs Vite SPA evaluated and decided**, plus a review of the rest of the stack                                                       |
| [`01-architecture.md`](./01-architecture.md) | Design point, goals, backend-imposed constraints, stack, rendering strategy, layering, routes, state ownership, budgets, degradation, risks |
| [`02-decisions.md`](./02-decisions.md)       | FE-0001 … FE-0014                                                                                                                           |
| [`03-flows.md`](./03-flows.md)               | Session machine, boot, auth, **refresh under concurrency**, timeline, compose, like, follow, realtime, search, logout, errors, navigation   |

### `04-modules/`

| Document                                                |                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`api-client.md`](./04-modules/api-client.md)           | The only code allowed to call `fetch` — auth, retries, idempotency, errors, headers |
| [`data-layer.md`](./04-modules/data-layer.md)           | Cache keys, staleness, pagination, optimistic mutations, **count reconciliation**   |
| [`realtime-client.md`](./04-modules/realtime-client.md) | Socket lifecycle, tickets, backoff, dedupe, polling fallback                        |
| [`design-system.md`](./04-modules/design-system.md)     | Tokens, primitives, feedback states, motion, a11y baseline                          |
| [`feature-modules.md`](./04-modules/feature-modules.md) | timeline · composer · post · profile · notifications · search · auth                |

### `05-cross-cutting/`

| Document                                                                                  |                                                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`security.md`](./05-cross-cutting/security.md)                                           | Threat model, token handling, CSP, XSS, storage inventory                         |
| [`performance-and-accessibility.md`](./05-cross-cutting/performance-and-accessibility.md) | Budgets, loading, runtime perf; WCAG 2.2 AA, feed semantics, focus, announcements |
| [`observability.md`](./05-cross-cutting/observability.md)                                 | Trace continuity with the backend, Web Vitals, metrics, alerts                    |
| [`testing.md`](./05-cross-cutting/testing.md)                                             | Risk-targeted strategy; the tests that must exist                                 |

| [`06-review.md`](./06-review.md) · [`07-roadmap.md`](./07-roadmap.md) | Design review and delivery plan |

---

## The design in one page

**Design point:** 200K DAU, ~65% mobile, mid-tier Android on 4G as the target device. **Timeline scroll is 65% of all API traffic** — one screen dictates the architecture.

**Stack:** Next.js 15 App Router · TanStack Query · Zustand · Tailwind + Radix (via shadcn/ui) · MSW · Playwright. Evaluated against a Vite SPA in [`00-stack-review.md`](./00-stack-review.md) and confirmed — the deciding factor being that an SPA still needs a server to render share-preview meta tags, so it avoids a _framework_, not a _server_.

**The rendering rule:** public content is server-rendered and unauthenticated; authenticated content is client-rendered and talks directly to the API gateway. The access token lives in memory only, so the Next server cannot make authenticated calls — and should not, since the gateway is already a BFF.

### The load-bearing ideas

Each is forced by a specific backend behaviour, not chosen for taste:

| Idea                                               | Backend behaviour that forces it                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single-flight refresh, coordinated across tabs** | Refresh tokens rotate with reuse detection — two concurrent refreshes revoke the session family and log the user out                         |
| **Count-delta reconciliation**                     | `liked` is read-your-writes; `like_count` is approximate with ~10 s lag. Optimistically bumping the count makes every like visibly snap back |
| **Idempotency keys owned by the draft**            | Keys must survive process death, or a retry after a crash creates a duplicate post                                                           |
| **Uniform 404 rendering**                          | The backend returns 404 rather than 403 so existence is never confirmed. A "this is private" UI state undoes that                            |
| **Degraded ≠ empty**                               | The backend distinguishes "no results" from "we could not check". Collapsing them tells users a confident falsehood                          |
| **Realtime as enhancement, polling as floor**      | The backend treats realtime the same way — losing it costs latency, not data                                                                 |
| **Cursors are opaque**                             | Ranking may be added later, at which point a cursor stops being a post ID                                                                    |
| **`staleTime` derived from backend SLOs**          | Refetching faster than data can change is pure cost                                                                                          |

### Open with the backend

Two blocking items from [`06-review.md`](./06-review.md), both small additive changes, both far more expensive later:

- **F3 — SSR exhausts the anonymous rate limit.** Public pages are server-rendered, so every visitor's request comes from one IP against a 100/hour anonymous limit. The public surface would be down permanently, from launch, and this does not fail in staging.
- **F1 — Refresh token must be an httpOnly cookie.** As specified it is a body parameter, forcing web clients to store a 30-day credential in JS-readable storage — which defeats reuse detection rather than merely weakening storage.

---

## Conventions

- Documents state **decisions**, not options. Alternatives live in `02-decisions.md` with the reason they were rejected.
- Every constraint traces to a backend contract, cited by document and section.
- Findings are referenced as `Fx` ([`06-review.md`](./06-review.md)) and risks as `FRx` ([`01-architecture.md`](./01-architecture.md) §12).
- Every list has four states: loading, empty, error, **degraded**. The fourth is the one that gets forgotten.

## Status

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| Design         | v1.0, reviewed, approved conditional on backend F1 + F3      |
| Implementation | Not started — no `web/` package yet                          |
| Next           | Roadmap Phase F0; raise F1 and F3 with the backend in week 1 |
