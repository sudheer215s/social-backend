# Frontend Testing Strategy

Same principle as the backend's ([`testing-strategy.md`](../../03-cross-cutting/testing-strategy.md)): effort follows risk, not code volume. Coverage is a floor, never a target.

---

## 1. What can actually go wrong

| Risk                                       | Likelihood                | Impact                               | Caught by                                |
| ------------------------------------------ | ------------------------- | ------------------------------------ | ---------------------------------------- |
| **Concurrent refresh logs users out**      | High without coordination | **Severe**                           | Parallel-401 unit test + two-context E2E |
| Optimistic count flicker                   | High                      | Medium                               | Stale-counter integration test           |
| Draft loss                                 | Medium                    | **Severe** (users do not forgive it) | Crash-recovery E2E                       |
| Duplicate post from retry                  | Medium                    | High                                 | Idempotency E2E                          |
| Scroll restoration jumps                   | High                      | Medium                               | Virtualisation E2E                       |
| Private/blocked content leaking through UI | Low                       | **Critical**                         | 404-uniformity tests                     |
| Cache leaking across users                 | Low                       | **Critical**                         | User-switch E2E                          |
| API contract drift                         | Medium                    | High                                 | Generated types + CI diff                |
| Bundle regression                          | High                      | Medium                               | CI budget gate                           |
| Accessibility regression                   | High                      | High                                 | axe in CI + manual passes                |

The top row and the two critical-impact privacy rows are where the tests must exist regardless of how the rest of the suite looks.

---

## 2. The shape

```
        E2E (~25)              Playwright, real browser, MSW-free where possible
   Integration (~180)          components + data layer + MSW
      Unit (~500)              pure logic
      Static                   TypeScript, ESLint, generated types, budgets
```

Integration is the largest meaningful layer. Most frontend defects live in the interaction between a component, the query cache, and the network — none of which a unit test with a mocked hook can reach.

---

## 3. Static

| Check                                               | Prevents                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `tsc --noEmit`, strict + `noUncheckedIndexedAccess` | Array/index assumptions in batch response handling                  |
| ESLint boundaries                                   | Layer violations ([`01-architecture.md`](../01-architecture.md) §6) |
| `no-restricted-globals: fetch` outside `api-client` | Bypassing auth, idempotency, error normalisation                    |
| No `dangerouslySetInnerHTML`                        | XSS                                                                 |
| Cursor opacity rule                                 | String operations on opaque cursors                                 |
| Generated types diff                                | API contract drift (FE-0002)                                        |
| Bundle budgets                                      | Silent size creep                                                   |

The `fetch` restriction is the highest-value lint rule in the codebase: a stray call silently bypasses six cross-cutting concerns and no test would fail.

---

## 4. Unit

Pure logic, no DOM, no network.

| Area                     | Notable cases                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- |
| **Count reconciliation** | Server catches up / server stale / 15 s ceiling / negative guard / rapid toggle |
| Grapheme counting        | Emoji ZWJ (`👨‍👩‍👧‍👦` = 1), combining marks, RTL, surrogate pairs                     |
| Cursor handling          | Accumulation, `maxPages` eviction, never parsed                                 |
| Error normalisation      | `problem+json` → typed; malformed body → synthetic                              |
| Backoff                  | Full jitter distribution; 100 simulated clients do not synchronise              |
| Session state machine    | Every transition, including `Offline`                                           |
| Text segmentation        | Mention/hashtag/URL extraction against adversarial input                        |
| Token store              | Expiry margin, clear-on-logout                                                  |

Rule: **no mocking of `api-client`.** A test asserting a hook "called the client" tests nothing about whether the request was correct. If a test needs the network, it is an integration test with MSW.

---

## 5. Integration (MSW)

Real components, real query cache, real `api-client`, network mocked at the boundary (FE-0011). This exercises exactly the code most likely to be wrong.

### The tests that matter

**Concurrent refresh — the one that must exist:**

```
render a screen firing 20 parallel requests, all returning 401
→ assert MSW recorded exactly ONE POST /v1/auth/refresh
→ assert all 20 requests retried and succeeded
→ assert the session survived
```

Without this, the defect appears intermittently in production, under load, and looks like a backend bug.

**Stale counters — must use a deliberately stale mock:**

```
like a post → assert display = server + 1 immediately
refetch returning the OLD count (as the real backend does for ~10 s)
→ assert the display does NOT drop back
advance 15 s → assert the delta is cleared and the server value is shown
```

A mock that returns updated counts immediately hides this entire class of bug — which is precisely why most implementations ship with the flicker.

**Optimistic rollback across all copies:**

```
a post visible in timeline + profile + detail, like it, mutation fails
→ assert ALL THREE cached copies rolled back
```

**Post survives the fan-out window:**

```
publish → optimistic entry at head
refetch within 5 s returns a timeline WITHOUT the post (correct backend behaviour)
→ assert the optimistic entry is still shown
```

**Degraded ≠ empty:**

```
search returns { data: [], degraded: true }
→ assert DegradedState renders, EmptyState does not
```

**404 uniformity:**

```
private post / blocked user / deleted post all → 404
→ assert identical rendered output for all three
```

Others: duplicate WS notification ignored; unverified user sees disabled controls with a reason; rate-limit headers throttle background polling; `X-Degraded` surfaces a banner.

---

## 6. E2E (Playwright)

~25 journeys against a real browser and, where possible, a real backend from `docker compose`.

### High-risk journeys

| Test                                           | Asserts                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Two contexts, shared cookies, both refresh** | Exactly one refresh; both stay signed in (FR1)                                                                         |
| **Draft survives a crash**                     | Type → kill the page mid-publish → reopen → draft restored with the same idempotency key → retry produces **one** post |
| **User switch on one device**                  | Log in A → log out → log in B → assert no trace of A's timeline (FE-0014)                                              |
| **Scroll restoration**                         | Scroll 5 pages → open a post → back → exact offset, no jump (FR3)                                                      |
| **Share link cold**                            | Open `/@user/p/{id}` logged out → SSR content + OG tags < 2.0 s                                                        |
| **Offline → online**                           | Go offline mid-compose → draft kept → reconnect → publish succeeds                                                     |
| **Realtime multi-tab**                         | Two tabs, one notification, both receive it, neither duplicates                                                        |

### Standard journeys

Register → verify → first post · login → timeline → paginate · like/unlike · follow public and private · search + trending · notification → detail · settings update · logout.

Every E2E route also runs `axe` and asserts a keyboard-only path.

---

## 7. Accessibility

| Layer                    | Tool                              | Gate                |
| ------------------------ | --------------------------------- | ------------------- |
| Primitives               | `axe` per Storybook story         | CI                  |
| Screens                  | `axe-playwright` per route        | CI                  |
| Keyboard                 | Playwright keyboard-only journeys | CI                  |
| Contrast                 | Token-pair unit test              | CI                  |
| Screen reader            | VoiceOver/Safari, NVDA/Firefox    | Manual, per release |
| Zoom 200% / text spacing | Manual                            | Per release         |

Automation catches roughly 30–40% of real defects. Focus management across route changes, announcement quality, and navigation coherence in a virtualised feed are found only by using it — and they are the categories that matter most here.

---

## 8. Visual regression

Chromatic on every PR: all Storybook stories in light and dark, at mobile and desktop widths, including long-content overflow variants.

Long-content variants are explicit because usernames, display names, and hashtags are user-supplied and unbounded within their limits. A layout that works for "Jane Doe" and breaks on a 30-character username always reaches production — nobody types a 30-character username by hand while developing.

---

## 9. Performance

| Check                                       | Gate                |
| ------------------------------------------- | ------------------- |
| Lighthouse CI, throttled mid-tier profile   | LCP/INP/CLS budgets |
| Bundle size per route                       | Hard budget         |
| Long-task profiling during a 10-page scroll | None > 50 ms        |
| Memory after 20 pages                       | No unbounded growth |

Run on every PR against the throttled profile, not a developer machine.

---

## 10. Contract testing

MSW handlers and TypeScript types are both generated from the backend's committed OpenAPI spec. CI regenerates both and fails on any diff.

This is the frontend's `buf breaking`: a renamed backend field currently surfaces as `undefined` at runtime, in production, on screen. Generating from the spec makes it a build failure instead.

WebSocket frames are validated at runtime against a Zod schema mirroring `realtime-gateway.md` §3, with `realtime_malformed_frames_total` as the production signal for protocol drift — the socket has no OpenAPI equivalent, so a runtime check is the only guard.

---

## 11. Gates

| Gate                        | Requirement                                                    |
| --------------------------- | -------------------------------------------------------------- |
| Typecheck, lint, boundaries | Pass                                                           |
| Unit + integration          | Pass                                                           |
| Generated-type diff         | Clean                                                          |
| Bundle budgets              | Within limits                                                  |
| axe (stories + routes)      | Zero violations                                                |
| Visual regression           | Reviewed                                                       |
| E2E (main)                  | Pass                                                           |
| Lighthouse                  | Budgets met                                                    |
| Coverage                    | ≥ 70% `data/` and `api-client/`, ≥ 50% elsewhere — **a floor** |

Coverage is weighted toward `data/` and `api-client/` because that is where the correctness-critical logic lives. A PR that raises coverage while adding no assertions is a regression in disguise; a single integration test asserting one refresh under 20 parallel 401s may move coverage barely at all and be the most valuable test in the suite.

---

## 12. Test data

Deterministic fixtures mirroring the backend's seed ([`data-management.md`](../../03-cross-cutting/data-management.md) §8), including the edge cases the design turns on:

a private account · a blocked pair · a large account past the fan-out threshold · a deleted post with replies · a user following nobody · a 30-character username · a post that is a single emoji ZWJ sequence · an aggregated notification with `actor_count: 50` and 8 stored actors.

Fixtures containing only ordinary data would let the private-content leak, the grapheme counter, the aggregation renderer, and the empty-timeline state all reach production untested — each of which this architecture specifically introduces machinery to handle.
