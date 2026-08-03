# Performance and Accessibility

Grouped deliberately: on the target device they are the same problem. A feed that drops frames is unusable with a screen reader, and a DOM heavy enough to break assistive technology is heavy enough to break INP.

---

# Part 1 — Performance

## 1. Budgets

Enforced in CI against a throttled profile: **4× CPU slowdown, 4G, mid-tier Android**. Exceeding a budget fails the PR.

| Metric                   | Budget       | Why this number                               |
| ------------------------ | ------------ | --------------------------------------------- |
| LCP `/home` (warm)       | < 1.8 s      | Persisted cache should make this near-instant |
| LCP `/@user` (cold, SSR) | < 2.0 s      | Server-rendered; the share-link entry point   |
| **INP**                  | **< 200 ms** | The metric for a scroll-and-tap app           |
| CLS                      | < 0.1        | Skeletons must match real layout              |
| TTFB (SSR)               | < 400 ms     |                                               |
| JS — shell               | < 180 KB gz  | Everything needed to render the app frame     |
| JS — `/home` chunk       | < 90 KB gz   |                                               |
| CSS                      | < 30 KB gz   | Purged Tailwind                               |
| Long tasks during scroll | none > 50 ms | What virtualisation buys                      |

Measuring on a developer laptop is how budgets get quietly missed: the median device is roughly 6–8× slower, which turns a "fine" 40 ms task into a dropped frame.

## 2. Loading strategy

| Stage                  | Contents                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Critical (shell)       | Router, `api-client`, session bootstrap, `ui/` primitives in use, timeline skeleton |
| Deferred (after paint) | Realtime client, telemetry, composer, search                                        |
| On demand              | Settings, profile editor, image viewer, thread view                                 |

Route-level splitting with **prefetch on intent** (hover, `touchstart`, or focus) — not on render. Prefetching every visible link on a feed of 20 posts downloads 20 route chunks the user will mostly not visit, on a metered connection.

`next/font` with `display: swap` and preloaded Latin subsets. Fonts are self-hosted (see [`security.md`](./security.md) §7), which also removes a DNS + TLS round trip on the critical path.

## 3. Runtime performance

The three things that actually decide whether the feed is smooth:

**Virtualisation** (FE-0008). A post card is 30–60 DOM nodes; 100 posts is 3,000–6,000 nodes with images and timestamps. Without virtualisation, memory grows unbounded and INP fails after a few pages.

**One shared timestamp interval.** Relative times ("2m") need periodic updates. A timer per card means 100 wakeups per second — measurable battery drain and a recurring INP contributor. One interval at 30 s, broadcast via context, does the same job.

**Memoised cards with stable props.** `PostCard` is memoised, and callbacks come from stable references. An inline arrow function in the parent defeats memoisation entirely and re-renders every visible card on any state change — the single most common React performance bug, and the most invisible.

Additional: `content-visibility: auto` on off-screen sections (complements virtualisation for non-list content), images with explicit `width`/`height` to reserve space, `transform`/`opacity`-only transitions.

## 4. Network

| Technique                            | Effect                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Persisted query cache (FE-0014)      | Returning users render before the network responds                                          |
| Request dedup (TanStack Query)       | Parallel components asking for the same post make one request                               |
| Batch endpoints                      | The gateway composes; three RPCs per timeline page regardless of size (`api-gateway.md` §8) |
| Prefetch next page at 70%            | No visible loading state during scroll                                                      |
| Cancel in-flight on new search input | Saves the user's rate-limit budget                                                          |
| Proactive rate-limit backoff         | `RateLimit-Remaining` < 10% throttles background polling                                    |

## 5. Measurement

Field RUM via `web-vitals` (LCP, INP, CLS, TTFB, FCP) attributed by **route template**, never raw path. Lab checks via Lighthouse CI on every PR against the throttled profile.

Reported at **p75**, matching Core Web Vitals convention — averages hide precisely the tail that makes an app feel broken.

Bundle size is tracked per route with a CI diff comment. Budget regressions fail; small growth is visible in review, which is usually enough to prevent it.

---

# Part 2 — Accessibility

**Target: WCAG 2.2 AA.**

Primitive-level guarantees are in [`design-system.md`](../04-modules/design-system.md) §6. This covers application-level concerns, which is where feed applications typically fail.

## 6. The feed as a document

A timeline is a list of articles and must be structured as one.

```html
<main>
  <h1 class="sr-only">Home timeline</h1>
  <div role="feed" aria-busy="false" aria-labelledby="feed-heading">
    <article aria-posinset="1" aria-setsize="-1" tabindex="0">
      <h2 class="sr-only">Post by Jane Doe</h2>
      …
    </article>
  </div>
</main>
```

`role="feed"` is the correct pattern for an infinite, incrementally-loaded stream. Key details:

- **`aria-setsize="-1"`** — the total is genuinely unknown. Lying with a number is worse than declaring it unknown.
- **`aria-busy`** toggles while a page loads, so screen readers announce progress instead of silence.
- **Articles are focusable** (`tabindex="0"`), which is what makes `role="feed"`'s page-up/page-down navigation work.
- **`aria-posinset` is the true index in the loaded set, not the rendered index.** With virtualisation these differ, and using the rendered index would announce "1 of unknown" for whatever happens to be at the top of the window.

### The virtualisation / `role="feed"` tension

`role="feed"` assumes articles are present in DOM order; virtualisation deliberately removes off-screen ones. This is a genuine conflict, not a detail we can style around, and it is worth stating plainly rather than discovering during an audit.

What makes it acceptable:

- `aria-posinset` and `aria-setsize` describe the _logical_ set, so position announcements stay correct even though the DOM is a window onto it.
- `overscan: 5` keeps a buffer mounted either side of the viewport, so sequential navigation — which is how screen-reader users move through a feed — rarely reaches an unmounted item.
- The focused article is pinned mounted regardless of viewport position (§ below), so focus is never destroyed underneath the user.

What remains imperfect: a screen reader's "list all items" affordance sees only the mounted window, not the full loaded set. There is no way to have both virtualisation and complete DOM presence. The alternative — no virtualisation — costs INP and memory badly enough to make the feed unusable on the target device for _everyone_, including assistive-technology users, so the window is the better trade. **Verified in the manual screen-reader pass, not assumed.**

### Focus and virtualisation

Virtualisation removes DOM nodes. If the focused element is unmounted, focus falls to `<body>` and the user's position is lost — a complete loss of context for a keyboard or screen-reader user.

Mitigation: the virtualiser keeps the focused item mounted regardless of viewport position, and focus is restored by post ID after any re-render. Tested with keyboard-only navigation through five pages.

## 7. Announcements

| Event                 | Region                       | Politeness |
| --------------------- | ---------------------------- | ---------- |
| New posts available   | `role="status"`              | polite     |
| Post published        | `role="status"`              | polite     |
| Like/follow succeeded | none — visual state suffices | —          |
| Action failed         | `role="alert"`               | assertive  |
| New notification      | `role="status"`              | polite     |
| Page load complete    | `role="status"`              | polite     |

Successful likes are deliberately silent. Announcing every micro-interaction makes a screen reader unusable during scrolling — the failure mode of over-applying live regions.

Live region containers are rendered **on mount, empty**. A region inserted into the DOM at the same time as its content is frequently not announced at all.

## 8. Route changes

Client-side navigation does not move focus or announce anything by default, so a screen-reader user is left on a page that silently changed.

```
on route change:
  1. move focus to the new <h1> (tabindex="-1", focus, no scroll)
  2. announce the new page title via a polite live region
  3. update document.title
```

## 9. Keyboard

| Key                 | Action                                             |
| ------------------- | -------------------------------------------------- |
| `Tab` / `Shift+Tab` | Standard order; never trapped outside a modal      |
| `j` / `k`           | Next/previous post (opt-in; disabled while typing) |
| `n`                 | New post                                           |
| `/`                 | Focus search                                       |
| `Escape`            | Close overlay, restore focus to the trigger        |
| `?`                 | Keyboard shortcut help                             |

Single-key shortcuts are disabled when focus is in an input — otherwise typing "j" in the composer navigates the feed. WCAG 2.2 also requires single-character shortcuts be remappable or disableable; there is a settings toggle.

Skip link to `#main` as the first focusable element.

## 10. Forms

Every input has a `<label>` (not a placeholder). Errors are associated via `aria-describedby` and `aria-invalid`, announced on submit, and focus moves to the first invalid field. Required fields are marked in text, not by colour alone.

Backend `problem+json` field errors map directly onto this — `errors[].field` selects the input, `errors[].message` becomes its described-by text (`api-conventions.md` §2).

## 11. Content-specific

| Concern                  | Handling                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Relative timestamps      | `<time datetime="…">2m</time>` — the full timestamp in the attribute                  |
| Aggregated notifications | "Alice, Bob and 47 others liked your post" reads naturally; avatars are `aria-hidden` |
| Character counter        | `aria-live="polite"`, announced only at thresholds (260, 280) — not per keystroke     |
| Icon-only buttons        | `aria-label` required by type signature                                               |
| Avatars                  | `alt=""` when the name is adjacent (decorative); named otherwise                      |
| Truncated text           | Full text available; never truncated for screen readers                               |
| Loading skeletons        | `aria-hidden="true"` with `aria-busy` on the container                                |

The character counter is the subtle one: announcing on every keystroke makes composition unusable with a screen reader, and announcing nothing means hitting the limit without warning.

## 12. Preferences honoured

`prefers-reduced-motion` (global, §5 of design-system) · `prefers-color-scheme` · `prefers-contrast` · `prefers-reduced-transparency` · text zoom to 200% without loss of function · text spacing overrides without clipping.

Text zoom to 200% is the one most often broken by fixed-height containers, and it is a hard AA requirement.

## 13. Verification

| Layer          | Tool                                   | Gate        |
| -------------- | -------------------------------------- | ----------- |
| Primitives     | `axe` per Storybook story              | CI          |
| Screens        | `axe-playwright` on every route        | CI          |
| Keyboard       | Playwright, keyboard-only journeys     | CI          |
| Contrast       | Token-pair unit test                   | CI          |
| Screen reader  | Manual: VoiceOver/Safari, NVDA/Firefox | Per release |
| Zoom / spacing | Manual at 200%                         | Per release |

Automated tooling catches roughly 30–40% of real accessibility defects. The manual passes are where focus management, announcement quality, and navigation coherence are actually found — the categories that matter most in a feed app, and the ones no linter detects.
