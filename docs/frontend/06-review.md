# Frontend Design Review

**Reviewer role:** Senior frontend engineer, reviewing this plan as an independent party
**Date:** 2026-07-31
**Scope:** `docs/frontend/01`–`05`

Same standard applied to the backend documents: trace each mechanism end to end, check that two documents describing the same thing agree, and look for places where a design assumes a backend behaviour that was never specified.

**13 findings. 6 fixed in place; 5 require backend changes; 2 accepted as scope gaps.**

The most serious finding (**F3**) would have broken the entire public web surface on the first day of production traffic, and would not have appeared in any local or staging test.

---

## 1. Verdict

The architecture is sound and, more importantly, it is _specific_ — it is designed against this backend's actual consistency model rather than against a generic REST API. The parts carrying the most risk (single-flight refresh, count reconciliation, idempotency scoped to intent, uniform 404 rendering) are each justified against the backend contract that forces them.

The defects cluster in one revealing place: **the boundary between frontend assumptions and backend guarantees**. Five of thirteen findings are things the frontend needs that the backend has not specified — not because either side is wrong, but because nobody had yet read the two designs against each other. That is exactly what this review is for, and it is the argument for doing it before writing code rather than after.

---

## 2. Findings requiring backend changes

### F1 — Refresh token cannot be an httpOnly cookie as the API is specified · **Blocking · Backend change required**

**Where:** `identity-service.md` §3 vs FE-0005

The backend specifies `POST /v1/auth/refresh { refresh_token }` — the token in the request body. A browser client must therefore keep a 30-day credential somewhere JavaScript can read.

That does not merely weaken storage; **it defeats reuse detection itself**. The backend revokes the session family when a rotated token is presented twice — a control whose value depends on the attacker and the user not both holding a working token. With the token in `localStorage`:

1. XSS steals a 30-day credential.
2. Both parties refresh; reuse detection fires; the family is revoked.
3. The **user** is logged out. The attacker re-steals at the next login.

A rotating refresh token in JS-readable storage is barely better than a non-rotating one.

**Requested change** (additive, non-breaking):

```
POST /v1/auth/login    → additionally Set-Cookie: rt=<token>;
                         HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/refresh; Max-Age=2592000
POST /v1/auth/refresh  → accept the token from the `rt` cookie when present;
                         fall back to the body parameter for native clients
                         → rotation sets the new cookie in the same response
POST /v1/auth/logout   → clear the cookie
```

`SameSite=Strict` plus the single path-scoped endpoint confines the CSRF surface to one route; the rest of the API stays bearer-authenticated with no CSRF exposure.

**Until this ships, FE-0005's primary control does not exist**, and there is no frontend workaround that provides it.

---

### F3 — SSR will exhaust the anonymous rate limit immediately · **Critical · Backend change required**

**Where:** `api-gateway.md` §4 vs FE-0001

The backend rate-limits anonymous traffic at **100 requests/hour per IP**. Public profile and post pages are server-rendered (FE-0001), so those requests originate from **the Next.js server — a single IP for every visitor**.

The arithmetic is not marginal. At even a modest 50 public page views per minute, the shared budget is exhausted in **two minutes**, after which every public profile, every shared post link, and every crawler request returns 429. The public surface is the growth loop; it would be down permanently, from launch.

This is invisible in development and in staging: one developer generates a handful of requests per hour and stays well under the limit. It appears only under real traffic, and it appears as a total outage of one half of the product.

**Requested change** — one of:

| Option              | Mechanism                                                                                                 | Assessment                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **A (recommended)** | Trust `X-Forwarded-For` from an allow-list of internal SSR origins; rate-limit on the forwarded client IP | Correct semantics — limits the actual user, not the renderer. Requires the gateway to distinguish trusted upstreams |
| B                   | A service credential for the SSR renderer with its own, much higher limit                                 | Simple; loses per-user granularity, so one abusive visitor is invisible                                             |
| C                   | Exempt the SSR origin entirely                                                                            | Simplest; removes all protection from the public surface                                                            |

Option A is correct and is the standard resolution for any server-side renderer sitting in front of a rate-limited API. It requires the backend's rate-limit key derivation to accept a trusted forwarded IP — a small change, but one that must be made deliberately, since blindly trusting `X-Forwarded-For` from untrusted sources is itself a rate-limit bypass.

**Also affects the `anon` limit's purpose:** with SSR in front, per-IP anonymous limiting protects the _renderer_, not the API. Scraping protection needs to move to the edge (WAF/CDN) regardless.

---

### F2 — `POST /v1/realtime/ticket` has no rate-limit entry · **Backend gap**

**Where:** `api-gateway.md` §4

The rate-limit table has no scope for ticket issuance. Every WebSocket connection and **every reconnect** requires one, and a deploy closes up to 20,000 connections per instance (`realtime-gateway.md` §5).

Client-side jittered backoff spreads the reconnect wave — that part is handled ([`realtime-client.md`](./04-modules/realtime-client.md) §4). But an unlimited endpoint on the authenticated path is worth bounding on principle, and it currently falls through to the generic `read:general` bucket of 1,000/hour, which a reconnect loop could consume while starving the user's normal browsing.

**Requested:** an explicit `realtime:ticket` scope, ~20/minute per user. Generous for legitimate use (a reconnect every 3 seconds), tight enough to bound a runaway client.

---

### F10 — Unverified-user rejection is unspecified · **Backend gap**

**Where:** `identity-service.md` §4.1

The backend states that unverified accounts "may read but not post, follow, or like" but never specifies what a rejected attempt returns. The frontend needs to distinguish it from every other 4xx to render `UnverifiedGate` correctly ([`feature-modules.md`](./04-modules/feature-modules.md), `auth`) rather than showing a generic error.

**Requested:** `403` with a stable `problem.type` of `.../email-not-verified`. Without a machine-readable discriminator, the client would have to string-match an error title — which breaks on any copy change and cannot be localised.

---

### F11 — Avatars have no resolution path · **Backend gap**

**Where:** `identity-service.md` §2 (`avatar_media_id`), system design §2 (media is a non-goal)

`users.avatar_media_id` is an opaque ID, and the media service that would resolve it is explicitly out of scope. So the frontend has an identifier that resolves to nothing, on a component that appears dozens of times per screen.

**Accepted with a defined interim:** render deterministic generated avatars — initials on a colour derived by hashing the user ID. Stable per user, no network request, no layout shift, and no dependency on a service that does not exist. When a media service ships, `avatar_media_id` resolves to a CDN URL and the generated avatar becomes the fallback for users without one. The component interface does not change.

---

## 3. Findings fixed in these documents

### F4 — Phantom `counters` staleness config · **FIXED**

`data-layer.md` §2 listed `counters: 10_000` to match the backend's stated counter lag. **No query fetches counters.** `like_count` and the viewer's `liked` flag arrive embedded in post objects composed by the gateway (`api-gateway.md` §8), so they refresh with their containing post or page.

Dead configuration implying a query that does not exist is worse than no configuration: the next engineer reads it as a contract and builds on it. Removed, with an explicit note that counter freshness is governed by delta reconciliation, not a refetch interval.

### F5 — Optimistic post ID swap discards the virtualiser's measurement · **FIXED**

Two independently reasonable decisions collide. The composer keys its optimistic entry by `draftId`; the virtualiser keys items by post ID (FE-0008); the real post arrives with a server-generated UUIDv7 the client cannot predict (`post-service.md` §3 generates it in-process).

At the moment of a successful publish, the key changes, the cached height is discarded, the item re-measures, and content shifts — **directly under the user who just posted**, at the moment they are watching most closely.

**Fixed** with an explicit `heightCache.rename(draftId, real.id)` in the replacement path. Small fix; the value is in having found the seam at all, since neither module's own tests would have caught it.

### F6 — `role="feed"` and virtualisation conflict, unstated · **FIXED**

`role="feed"` assumes articles are present in DOM order; virtualisation removes them. The original draft specified both and never acknowledged the tension — which would have surfaced as an accessibility audit finding with no recorded rationale.

**Fixed** by stating it plainly: `aria-posinset` describes the logical set rather than the rendered window, `overscan` keeps sequential navigation on mounted items, the focused article is pinned mounted, and the residual limitation (a "list all items" affordance sees only the window) is documented as an accepted trade with the reasoning. Verified in the manual screen-reader pass rather than assumed.

### F7 — Persisted cache would grow without bound · **FIXED**

`dehydrateOptions` persisted every key prefixed `timeline` or `user`. A user browsing 50 profiles writes 50 timelines and 50 profiles to IndexedDB — **none of which is ever read**, because the boot path renders only the home timeline.

**Fixed** to persist exactly the home timeline and the current user. Persistence exists to make one screen fast (FE-0014); persisting more than that screen needs is storage cost with no benefit, on devices where storage pressure triggers eviction of the data that _was_ useful.

### F8 — Draft scoping inconsistent between documents · **FIXED**

`security.md` §8 stated drafts are "scoped per user ID"; the `Draft` type in `feature-modules.md` had no `userId`. Since drafts deliberately survive logout — so an expiring session does not destroy someone's writing — unscoped restoration would show user A's unfinished post to user B on a shared device.

**Fixed:** `userId` added to the type, storage keyed `draft:{userId}:{draftId}`, restoration filtered by current user, 30-day sweep.

### F9 — Search would refetch on tab focus · **FIXED**

`staleTime: 0` for search combined with the default `refetchOnWindowFocus: true` means every return to the tab re-runs the last query. Against a 30/min search budget (`api-gateway.md` §4), alt-tabbing while reading results burns the allowance for a result the user has already read.

**Fixed:** `refetchOnWindowFocus` explicitly disabled for search.

---

## 4. Accepted gaps

### F12 — No design for the Next.js server as a deployed artefact · **Roadmap Phase 1**

The architecture specifies what the Next server renders but not how it is deployed: where it runs relative to the cluster, ISR revalidation strategy and cache backing, CDN configuration, or its own health and scaling signals.

**Accepted** — it is a deployment concern that depends on F3's resolution (whether the renderer needs a trusted network position). Must be designed before the public surface ships, and it is on the Phase 1 exit criteria.

### F13 — i18n described as "extraction-ready" without a mechanism · **Post-v1**

`01-architecture.md` §2 claims the copy layer is extraction-ready and never says what that means.

**Accepted** with a concrete minimum so the claim is not empty: all user-facing strings go through a `t()` function from day one, even while it is an identity function returning English. Retrofitting extraction across a finished UI is a multi-week mechanical change; doing it from the start costs nothing. The backend renders no user-facing text (`notification-service.md` §2 stores no rendered message), so all copy genuinely is client-side.

---

## 5. What the design gets right

Worth recording, because these are the decisions that should survive contact with implementation pressure:

- **Single-flight refresh treated as a correctness requirement**, not an optimisation. The failure it prevents is intermittent, load-dependent, and misattributed to the backend.
- **Count reconciliation derived from the backend's own consistency table** rather than from what feels responsive.
- **Idempotency keys owned by the draft**, surviving process death. The subtlety — that a key generated per HTTP attempt defeats the entire mechanism — is stated explicitly where an implementer will read it.
- **Uniform 404 rendering** preserving the backend's deliberate refusal to confirm existence, including in analytics.
- **Realtime as an enhancement**, mirroring the backend's own position that losing it costs latency, not data.
- **Degraded ≠ empty** carried through every list component. The backend distinguishes them; most clients would collapse the distinction at the last mile.
- **`staleTime` derived from backend SLOs** rather than guessed.

---

## 6. Cross-boundary summary

For the backend team. Two blocking, three small.

| #      | Change                                                                      | Severity                                             | Effort               |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------- |
| **F3** | Trust `X-Forwarded-For` from allow-listed SSR origins for rate-limit keying | **Critical — public surface is unusable without it** | Small                |
| **F1** | httpOnly refresh cookie alongside the body parameter                        | **Blocking for FE-0005**                             | Small                |
| F2     | `realtime:ticket` rate-limit scope                                          | Low                                                  | Trivial              |
| F10    | Stable `problem.type` for unverified-user rejection                         | Low                                                  | Trivial              |
| F11    | Confirm generated avatars as the interim                                    | Low                                                  | None (frontend-only) |

F3 and F1 should be raised now. Both are small, additive backend changes, and both are far more expensive to discover later — F1 because retrofitting token storage touches every auth path, and F3 because it does not fail until production traffic arrives.

---

## 7. Recommendation

**Approved for implementation, conditional on F1 and F3 being accepted by the backend.**

The three things most needing validation by running code rather than review:

1. **Single-flight refresh under real concurrency** — the two-context Playwright test is the acceptance criterion for the whole auth design.
2. **Timeline scroll restoration** with virtualisation, infinite query, and the F5 key swap. Three interacting mechanisms; the interactions are where it breaks.
3. **Perceived performance of the skeleton-first `/home`** — FE-0014's persisted cache is the mitigation for having no authenticated SSR, and whether it is _sufficient_ is a measurement, not an argument.

Thirteen findings before writing code, five of which are contract mismatches between two designs that each looked complete on their own, is a reasonable yield — and considerably cheaper than finding F3 on launch day.
