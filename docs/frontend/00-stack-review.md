# Tech Stack Review

**Date:** 2026-07-31
**Question:** Next.js or a plain React SPA — and is the rest of the stack right?
**Outcome:** **Next.js confirmed.** One change to the design-system approach (§7).

---

## 1. Framing

"Next.js or React" is a category error worth correcting before deciding: **Next.js _is_ React.** The real choice is between:

|       |                                                   |
| ----- | ------------------------------------------------- |
| **A** | Next.js 15 (App Router) — React plus a server     |
| **B** | Vite + React SPA — React, static files, no server |

Both ship the same React app to the browser. The decision is whether we operate a server that renders HTML.

### What makes this genuinely close

A constraint from our own design makes the usual answer suspect. Because the access token lives in memory only (FE-0005), **the Next.js server cannot make authenticated API calls.** So `/home`, notifications, search, settings, compose — roughly 90% of the application by both surface area and usage — are client-rendered under either option.

Next.js's headline feature is unavailable to us for almost the entire app. That deserves scrutiny rather than a default.

---

## 2. Candidates

| Option                     | Assessment                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js 15 App Router**  | Industry default. SSR/ISR for public routes, OG image generation, file routing. Costs a Node runtime and RSC boundary complexity                                                                               |
| **Vite + React SPA**       | Simplest possible: static files on a CDN, no server, fastest builds. No server-rendered HTML at all                                                                                                            |
| **Remix / React Router 7** | Excellent nested routing and error boundaries. Its core strength is server loaders with session cookies — **precisely the model FE-0005 rejects**, so we would pay for a capability we deliberately do not use |
| **Astro**                  | Outstanding for content-heavy sites. Wrong shape for an app that is 90% interactive client state                                                                                                               |
| **TanStack Start**         | Conceptually well-matched. Too young to carry a project on. Revisit in a year                                                                                                                                  |

Remix and Astro are eliminated on fit, TanStack Start on maturity. The real contest is A vs B.

---

## 3. Criteria, weighted for this project

Weights reflect what this project actually is: a solo-operated portfolio system whose value is the distributed backend, with a 22-week backend roadmap currently at Phase 0.

| Criterion                              | Weight   | Next.js                | Vite SPA                   |
| -------------------------------------- | -------- | ---------------------- | -------------------------- |
| Authenticated app quality              | High     | — equal —              | — equal —                  |
| **Share-link previews (OG cards)**     | **High** | ✅ built in            | ❌ needs a custom solution |
| SEO on public profiles/posts           | Medium   | ✅                     | ❌                         |
| Operational surface                    | High     | ➖ Node runtime        | ✅ static files            |
| Avoids finding **F3** (SSR rate limit) | Medium   | ❌ needs a backend fix | ✅ n/a                     |
| Build speed / mental model             | Medium   | ➖ RSC boundaries      | ✅ simpler                 |
| Hosting cost                           | Low      | ➖                     | ✅                         |
| Hiring/portfolio signal                | Medium   | ✅ ubiquitous          | ➖                         |

Authenticated app quality is identical and therefore decides nothing — which is exactly why this looked like a close call.

---

## 4. The decisive argument

Everything above nearly cancels out. What breaks the tie is that **option B does not actually avoid running a server.**

A social product must render a preview card when a link is pasted into Slack, WhatsApp, iMessage, or X. That requires server-rendered `<meta>` tags — crawlers do not execute JavaScript reliably, and the ones that do will not wait for an authenticated API round trip. There is no client-side workaround.

So the Vite path forks:

| Sub-option                                    | Reality                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| B1 — drop share previews                      | Sharing is the product's growth loop. Not viable for a social app, and it also means a link to your own demo renders as a bare URL |
| B2 — SPA + an edge function injecting OG tags | **You now operate a server anyway** — a bespoke, undocumented one, with weaker SEO, that you maintain yourself                     |

B2 is the honest version of "no server", and it trades a well-documented framework for ~100 lines of custom infrastructure doing a worse job of the same thing. That is not a simplification; it is a smaller thing you have to think about more.

Once a server is required regardless, Next.js's costs stop being costs and start being features already paid for: routing, ISR caching, OG image generation, and a deployment story that thousands of people have already debugged.

### On F3

The strongest argument against Next.js is that SSR creates finding F3 — server-rendered pages originate from one IP and exhaust the 100/hour anonymous rate limit ([`06-review.md`](./06-review.md) F3).

It is a real problem and it does not apply to a pure SPA. But it is **an hour of backend work that we control**: accept `X-Forwarded-For` from an allow-listed SSR origin when deriving the rate-limit key. Option B2 would need the same fix for its edge function. Weighing a one-hour change against permanently losing share previews and SEO is not a close call.

---

## 5. Decision

> **Next.js 15, App Router.** ADR FE-0001 stands, now on the strength of this review rather than assertion.

The rendering rule in [`01-architecture.md`](./01-architecture.md) §5 is what keeps the cost contained: public routes are server-rendered and unauthenticated; everything authenticated is client-rendered and talks directly to the gateway. RSC complexity is confined to four public routes. The rest of the app is ordinary React with `'use client'`, and would look nearly identical under Vite.

**Deployment:** run it as a container near the cluster rather than on a managed platform. F3's fix requires the gateway to recognise the SSR origin as a trusted upstream, which is materially simpler when it has a stable, known network identity. Vercel remains viable if that trust boundary is expressed some other way (a service credential), but the container is the lower-friction path given the backend already runs in Kubernetes.

### Revisit triggers

Reopen this decision if any becomes true:

1. **The public surface is dropped** (invite-only, or app-first). Next.js becomes pure overhead → Vite.
2. **Operating a Node runtime proves burdensome** for a solo maintainer → Vite + B2, accepting weaker SEO.
3. **The backend rejects F3** and no alternative is agreed. SSR would be unusable in production.
4. **TanStack Start reaches maturity** and the RSC model still feels like poor value.

---

## 6. Rest of the stack — confirmed

Reviewed alongside the framework; each holds.

| Choice                       | Verdict | Note                                                                                                                                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Query**           | Keep    | `useInfiniteQuery` maps 1:1 onto the backend's cursor envelope; the mutation lifecycle is what makes count reconciliation tractable. SWR would work; this is better for the hard part |
| **Zustand**                  | Keep    | Once Query owns server state, remaining client state is small. Redux would be ceremony without a matching problem                                                                     |
| **Tailwind + Radix + CVA**   | Keep    | Radix supplies focus trapping, ARIA wiring, and dismissal semantics — the parts that are hard and that hand-rolled components get wrong                                               |
| **openapi-typescript**       | Keep    | The frontend's `buf breaking`. Non-negotiable given independent deploys                                                                                                               |
| **MSW**                      | Keep    | Mocking at the network layer means tests exercise the real `api-client`. Also lets us mock the backend's _awkward_ behaviours — stale counters, `X-Degraded`, 401-then-refresh        |
| **TanStack Virtual**         | Keep    | A post card is 30–60 DOM nodes; 100 posts fails INP on the target device                                                                                                              |
| **Playwright**               | Keep    | The multi-tab refresh test (FR1) is not expressible in jsdom                                                                                                                          |
| **Vitest + Testing Library** | Keep    |                                                                                                                                                                                       |

---

## 7. One change: adopt shadcn/ui as the starting point

**Finding.** [`design-system.md`](./04-modules/design-system.md) specifies hand-building ~22 primitives on Radix + Tailwind + CVA. That is _exactly_ what shadcn/ui already is — the same three libraries, assembled, delivered by copy-paste into your own repo.

ADR FE-0006 mentions shadcn/ui and sets it aside as "effectively this decision, delivered by copy-paste". Reviewing it against the project's actual constraint — a solo maintainer with a 22-week backend still ahead — that reasoning inverts. There is no ownership or lock-in argument, because shadcn/ui components _are_ your source code the moment you add them: no runtime dependency, no version to upgrade, fully editable.

**Change:** start from shadcn/ui, then delete and edit freely. Keep every constraint from `design-system.md` — the token system, the 44px tap target, contrast tests, axe per story, and the deliberately small inventory. shadcn/ui is a starting point, not a component library to accumulate.

Saves roughly a week of work that produces no product differentiation, at no architectural cost. `design-system.md` and FE-0006 are updated accordingly.

---

## 8. Note on scope

Outside the stack question, but it bears on it: the backend is a 22-week roadmap currently at Phase 0, with no domain service built. The frontend plan adds 14 weeks on top. For a solo developer that is a long way from anything demo-able.

The framework decision holds regardless — but if timeline becomes a concern, the lever is **scope, not stack**. Cut in this order:

1. Search UI (Phase F5) — the backend can be demonstrated with `curl`
2. Realtime (F4) — polling delivers the same product at a fraction of the effort
3. Virtualisation (F2 week 7) — cap `maxPages` lower and accept a memory ceiling

Each removes weeks. None changes the architecture, and each can be added later without rework. Dropping Next.js, by contrast, saves days and costs the entire public surface.
