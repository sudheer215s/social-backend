# Frontend Implementation Roadmap

Sequenced against the backend roadmap ([`../05-roadmap/implementation-roadmap.md`](../05-roadmap/implementation-roadmap.md)). The frontend cannot outrun the API it consumes, but it can — and should — start before the API is finished, because MSW gives us a complete mock backend derived from the OpenAPI spec (FE-0011).

**14 weeks, 6 phases**, starting when backend Phase 1 (identity) is in progress.

---

## 1. Backend dependency map

| FE phase                    | Requires backend                    | Can start when                 |
| --------------------------- | ----------------------------------- | ------------------------------ |
| F0 Foundation               | Nothing (MSW only)                  | Immediately                    |
| F1 Auth + shell             | Backend Phase 1 (identity, gateway) | BE P1 week 2                   |
| F2 Timeline read            | Backend Phase 4 (timeline)          | BE P4 week 1 — mock until then |
| F3 Write paths              | Backend Phase 2 (posts, graph)      | BE P2 complete                 |
| F4 Notifications + realtime | Backend Phase 5                     | BE P5 week 1                   |
| F5 Search + public surface  | Backend Phase 6                     | BE P6 week 1                   |
| F6 Hardening + launch       | Backend Phase 7–8                   | Parallel                       |

**Building against MSW is the point, not a workaround.** Handlers are generated from the same OpenAPI spec that generates the types, so a screen built against mocks is built against the real contract. When the backend lands, integration is a config change plus the discovery of whatever the spec got wrong — which is far cheaper than blocking.

---

## Phase F0 — Foundation · Weeks 1–2

No user-visible features. Everything after this depends on it.

**Workspace:** `web/` added to the pnpm workspace; Next.js 15 App Router; TypeScript strict inheriting `tsconfig.base.json`; ESLint with `eslint-plugin-boundaries` for the six layers; Tailwind + CVA tokens; Turbo tasks wired into the existing pipeline.

**`api-client`:** the full pipeline — deadlines, retry policy, `problem+json` normalisation, `traceparent` injection, header side channel. **Single-flight refresh with cross-tab locking is built here, in week 1, not retrofitted.**

**Type and mock generation:** `pnpm api:types` from the committed OpenAPI spec; MSW handlers from the same source; CI diff gate.

**`ui/` kit:** ~22 primitives with Storybook, axe per story, Chromatic.

**CI:** typecheck, lint, boundaries, unit, integration, bundle budgets, Lighthouse on the throttled profile, axe, visual regression.

### Exit criteria

- [ ] A trivial authenticated screen renders against MSW end to end
- [ ] **20 parallel 401s produce exactly one refresh** (the F0 acceptance test)
- [ ] Generated types fail CI on a spec change
- [ ] Bundle budget gate fails a deliberately oversized PR
- [ ] Storybook deployed; axe passes on every story
- [ ] A browser-initiated trace reaches the collector

> The refresh test is the single most important thing in F0. It is cheap now and expensive later, and the defect it prevents is intermittent and misattributed to the backend.

---

## Phase F1 — Auth and app shell · Weeks 3–5

**Delivers:** session state machine, login/register/verify/reset, app shell, `SessionBoundary`, `UnverifiedGate`, telemetry.

Week 3 — session state machine, boot sequence, `SessionBoundary`, route guards with `?next=` preservation.
Week 4 — auth forms with anti-enumeration behaviour, error mapping from `problem+json`, verification and reset flows, `UnverifiedGate`.
Week 5 — app shell, navigation, theming, error boundaries, OTel + Web Vitals wiring, offline detection.

### Exit criteria

- [ ] Register → verify → login → refresh → logout against the **real backend**
- [ ] **Two browser contexts sharing cookies both refresh → one refresh call, both stay signed in**
- [ ] Reuse-detection response produces the security-specific message
- [ ] Network error during refresh does **not** log the user out
- [ ] Login timing and copy identical for unknown-email and wrong-password
- [ ] Unverified state renders as a normal state, not an error
- [ ] No token in `localStorage`/`sessionStorage` (asserted by test)
- [ ] **F1 (httpOnly cookie) resolved with the backend** — see [`06-review.md`](./06-review.md)

---

## Phase F2 — Timeline · Weeks 6–8

The screen that is 65% of traffic. Three weeks, deliberately.

Week 6 — `useInfiniteQuery` with opaque cursors, `PostCard`, skeletons matching real layout, `maxPages` bounding.
Week 7 — virtualisation, height cache by post ID, scroll restoration, prefetch at 70%.
Week 8 — new-posts pill, degradation banner, persisted cache (FE-0014), performance tuning against budgets.

### Exit criteria

- [ ] Paginate 10 pages: no duplicates, no gaps, stable under concurrent inserts
- [ ] **Scroll restoration exact after back-navigation from a post** (risk FR3)
- [ ] Cursors never parsed (lint-enforced and reviewed)
- [ ] New posts never auto-injected into a scrolled list
- [ ] `X-Degraded` surfaces as a banner
- [ ] **60 fps scroll, no long task > 50 ms, on the throttled profile**
- [ ] Warm-cache LCP < 1.8 s; INP < 200 ms
- [ ] `role="feed"` verified in a manual screen-reader pass, including the F6 limitation
- [ ] Memory stable after 20 pages

---

## Phase F3 — Write paths · Weeks 9–10

Week 9 — composer: draft store with user scoping, grapheme counting, idempotency keys, optimistic publish, `heightCache.rename` on ID swap (F5).
Week 10 — like/repost/follow/block/mute with optimistic booleans and **count-delta reconciliation**; profile screens; thread view.

### Exit criteria

- [ ] **Draft survives a crash mid-publish; retry with the same key yields one post** (`Idempotent-Replay: true`)
- [ ] Drafts scoped per user; a second user on the device sees none
- [ ] Grapheme counter agrees with the server on emoji ZWJ sequences
- [ ] **Optimistic like does not flicker against a deliberately stale counter mock**
- [ ] Optimistic rollback covers _every_ cached copy of a post
- [ ] New post survives a refetch inside the 5 s fan-out window
- [ ] Follow renders `requested` for private accounts, not `following`
- [ ] `404` on follow renders generic not-found

---

## Phase F4 — Notifications and realtime · Weeks 11–12

Week 11 — notification list, aggregation rendering (`actor_count`, not `actor_ids.length`), unread badge with delta reconciliation, read-state mutations.
Week 12 — WebSocket client: ticket exchange, backoff with full jitter, close-code handling, dedupe, catch-up, polling fallback.

### Exit criteria

- [ ] Notification → visible in < 1 s while connected
- [ ] **Reconnect fetches a new ticket** (never replays the URL)
- [ ] Duplicate delivery rendered once
- [ ] Reconnect with `since` replays exactly the missed set
- [ ] `4403` stops reconnecting; `4408` re-tickets silently
- [ ] Two consecutive failures → polling fallback; both paths merge identically
- [ ] Backoff jitter: 100 simulated clients do not synchronise
- [ ] Aggregated notification with `actor_count: 50` renders "and 47 others"
- [ ] Socket loaded after first paint, never on the critical path

---

## Phase F5 — Search and the public surface · Weeks 13

Week 13 — search with debounce and cancellation, `DegradedState`, trending; SSR public routes (profile, post, hashtag) with ISR; OG image generation; hydration overlay for viewer state.

### Exit criteria

- [ ] `degraded: true` renders "temporarily limited", **never** "no results"
- [ ] Search stays within the 30/min budget while typing continuously
- [ ] Public post page: SSR + OG tags, cold LCP < 2.0 s logged out
- [ ] Hydration overlay never shows a wrong follow state — neutral until known
- [ ] **F3 (SSR rate limiting) resolved and verified under load**
- [ ] Crawler receives fully rendered content

> F3 must be verified with a load test that drives public pages through the SSR path at realistic rates. It is the finding that does not fail until production traffic arrives, so staging must be made to look like production traffic on purpose.

---

## Phase F6 — Hardening and launch · Week 14

CSP from report-only to enforcing; full accessibility pass (screen reader, 200% zoom, text spacing); performance tuning against all budgets; the complete E2E suite; error-state copy review; launch checklist.

### Exit criteria

- [ ] All budgets met on the throttled profile at p75
- [ ] Zero axe violations across stories and routes
- [ ] Manual screen-reader pass on every primary journey
- [ ] CSP enforcing with zero violations for two weeks
- [ ] **User-switch test: no trace of the previous user's data**
- [ ] Full E2E suite green against the real backend
- [ ] Penetration test findings closed
- [ ] Runbooks for the paging alert (`session_lost{reason="reuse_detected"}`)

---

## 2. Cross-phase, every phase

- **Accessibility:** axe on new stories and routes; keyboard path for every new interaction.
- **Performance:** budgets enforced per PR; no phase closes over budget.
- **Testing:** unit + integration for all new logic; E2E for each new journey.
- **Observability:** spans and metrics for new flows before the phase closes.
- **Docs:** the module doc updated to match what was built.
- **ADRs:** divergence from `02-decisions.md` recorded there.

---

## 3. Sequencing constraints

```
F0 ──► F1 ──► F2 ──► F3 ──► F4
                       └──► F5
              F2 ──────────────► F6
```

| Constraint           | Why                                                        |
| -------------------- | ---------------------------------------------------------- |
| F0 before everything | `api-client` and the type pipeline are the substrate       |
| F1 before F2         | The timeline needs a session                               |
| F2 before F3         | Optimistic writes need somewhere to render optimistically  |
| F3 before F4         | Notification cache patterns reuse the delta reconciliation |
| F4 and F5 parallel   | Independent; only shared surface is the post card          |

F4 and F5 can run in parallel with a second engineer. Nothing else usefully parallelises.

---

## 4. Risks to the plan

| Risk                                                         | Mitigation                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **F1/F3 not accepted by the backend**                        | Raise in week 1, not week 12. F1 blocks the auth model; F3 blocks the public surface. Neither has a frontend workaround      |
| F2 overruns (virtualisation + restoration is genuinely hard) | Three weeks allocated. Fallback: ship without virtualisation and a lower `maxPages`, accepting a memory ceiling, then add it |
| Building against MSW hides contract errors                   | Handlers generated from the spec; F1/F2 exit criteria require the **real** backend                                           |
| Budgets erode gradually                                      | CI gate, not a report. A failing PR is the enforcement                                                                       |
| Backend phases slip                                          | F0 and the `ui/` kit are unblocked; MSW covers the rest for a phase or two                                                   |

---

## 5. First week

1. `web/` in the workspace; Next.js 15; strict TS inheriting the base config.
2. ESLint boundaries for the six layers — **before** there is code to violate them.
3. Type + MSW generation from the OpenAPI spec; wire the CI diff gate.
4. `api-client` skeleton with the request pipeline.
5. **Single-flight refresh with cross-tab locking, and its 20-parallel-401 test.**
6. Raise **F1 and F3** with the backend team.

Item 5 is the F0 acceptance test in miniature, and item 6 is the highest-value hour in the entire fourteen weeks: both findings are small additive backend changes now, and expensive discoveries later — F1 because retrofitting token storage touches every auth path, F3 because it does not fail until real traffic arrives.
