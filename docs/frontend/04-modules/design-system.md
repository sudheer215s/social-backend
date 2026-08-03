# Module — `ui` (Design System)

**Responsibility:** presentational primitives and layout. Zero application knowledge.
**Depends on:** Radix UI, Tailwind, CVA
**Consumed by:** `features/` and `app/`

---

## 1. Boundary

`ui/` **may not** import API types, data hooks, feature modules, or route helpers. Enforced by lint (FE-0013).

The test: every component here should be renderable in Storybook from props alone, with no provider and no network. A `<PostCard>` that fetches its own author is not a UI primitive — it is a feature component, and it belongs in `features/post/`.

This is not purity for its own sake. It is what keeps the visual layer testable without MSW, reviewable without domain context, and reusable by a future native client's web views.

---

## 2. Tokens

Tailwind config, exposed as CSS custom properties so dark mode is a class swap rather than a re-render.

```css
:root {
  --bg: 255 255 255;
  --bg-subtle: 249 250 251;
  --bg-inset: 243 244 246;
  --fg: 17 24 39;
  --fg-muted: 107 114 128;
  --border: 229 231 235;
  --accent: 29 78 216;
  --accent-fg: 255 255 255;
  --danger: 185 28 28;
  --success: 21 128 61;

  --radius: 0.75rem;
  --space: 0.25rem; /* 4px base; scale is 1,2,3,4,6,8,12,16 */
  --font-sans: var(--font-inter), system-ui, sans-serif;

  --tap-min: 44px; /* minimum interactive target — mobile-first */
}
.dark {
  --bg: 3 7 18;
  --fg: 243 244 246; /* … */
}
```

Colours as space-separated RGB channels so Tailwind's `/opacity` modifier works (`bg-[rgb(var(--bg)/0.8)]`).

`--tap-min: 44px` is a token rather than a convention because 65% of sessions are mobile and undersized tap targets are the most common accessibility defect in feed UIs. Making it a token means it can be asserted.

### Contrast

Every foreground/background pair meets **WCAG AA** (4.5:1 body, 3:1 large text and UI boundaries). Asserted in CI by a token-contrast test — not checked by eye, because dark mode variants are exactly where this silently regresses.

---

## 3. Inventory

Roughly 22 primitives. A feed app needs a small kit; a large one is a sign that features are leaking into `ui/`.

**Start from shadcn/ui** ([`00-stack-review.md`](../00-stack-review.md) §7) — it is Radix + Tailwind + CVA already assembled, copied into our repo as ordinary source. Add only what a screen needs, then edit freely to match the tokens in §2. Everything in this document still applies to a copied component: it is our code the moment it lands, including its accessibility.

| Group      | Components                                                                      | Base          |
| ---------- | ------------------------------------------------------------------------------- | ------------- |
| Layout     | `Stack`, `Inline`, `Container`, `Divider`, `Grid`                               | —             |
| Typography | `Text`, `Heading`, `Link`, `Truncate`                                           | —             |
| Controls   | `Button`, `IconButton`, `ToggleButton`, `Input`, `Textarea`, `Switch`, `Select` | Radix         |
| Overlay    | `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `Tooltip`                         | Radix         |
| Feedback   | `Toast`, `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`                      | Radix (Toast) |
| Display    | `Avatar`, `Badge`, `Card`, `Tabs`, `ScrollArea`                                 | Radix         |

Radix supplies focus trapping, focus restoration, ARIA wiring, keyboard interaction, and dismissal semantics — the parts that are hard to get right and expensive to get wrong (FE-0006).

### Variants via CVA

```ts
export const button = cva(
  'inline-flex items-center justify-center rounded-[--radius] font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 ' +
    'disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:
          'bg-[rgb(var(--accent))] text-[rgb(var(--accent-fg))] hover:opacity-90',
        secondary: 'bg-[rgb(var(--bg-inset))] text-[rgb(var(--fg))]',
        ghost: 'hover:bg-[rgb(var(--bg-subtle))]',
        danger: 'bg-[rgb(var(--danger))] text-white',
      },
      size: {
        sm: 'h-9 px-3 text-sm min-w-[--tap-min]',
        md: 'h-11 px-4 text-sm min-w-[--tap-min]',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
```

`focus-visible` rather than `focus`: mouse users do not see a ring, keyboard users always do. Removing focus rings entirely is the second most common accessibility defect after tap-target size, and it is usually done deliberately.

---

## 4. Feedback components carry real meaning

Three components encode the backend's contracts and are worth specifying rather than improvising.

### `Skeleton`

Must match the **real layout**, not be a generic grey box. A skeleton with different dimensions than the content it replaces causes layout shift on load and fails the CLS budget. Post skeletons carry the exact avatar size, line count, and action-row height of a real card.

### `ErrorState`

```tsx
<ErrorState
  title="Couldn't load your timeline"
  action={{ label: 'Try again', onClick: retry }}
  traceId={error.traceId} // small, copyable, always present
/>
```

The trace ID is rendered because the backend puts one in every `problem+json` body specifically so a user report becomes a single trace lookup (`api-conventions.md` §2). Discarding it in the UI wastes a deliberate backend affordance.

### `EmptyState` vs degraded

Two visually distinct components, because they mean opposite things:

| Situation                         | Component       | Copy                                                |
| --------------------------------- | --------------- | --------------------------------------------------- |
| Query genuinely matched nothing   | `EmptyState`    | "No results for _nestjs_"                           |
| Backend returned `degraded: true` | `DegradedState` | "Search is temporarily limited. Try again shortly." |

Rendering the second as the first tells the user a confident falsehood about their own data. The backend went to the trouble of distinguishing them (`search-service.md` §7); the UI must not collapse them.

---

## 5. Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Applied globally, not per-component, so a new animation cannot forget it. Durations are short by default (120 ms micro, 200 ms overlay); transitions animate `transform` and `opacity` only, never layout properties, which is what keeps scroll at 60 fps.

---

## 6. Accessibility baseline

Every primitive ships with these guarantees, verified by an axe test in its story:

| Guarantee          | Notes                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| Keyboard operable  | Tab order, Enter/Space, Escape to dismiss                                         |
| Visible focus      | `focus-visible` ring, never removed                                               |
| Accessible name    | Icon-only buttons require `aria-label` — enforced by types                        |
| Target size ≥ 44px | `--tap-min`                                                                       |
| Contrast ≥ AA      | Token-level test                                                                  |
| Announced state    | `aria-pressed` on toggles, `aria-expanded` on disclosures, `aria-busy` on loading |
| Reduced motion     | Global                                                                            |

Icon-only buttons enforce their label **in the type signature** — `IconButton` requires `aria-label`, so omitting it is a compile error rather than an audit finding.

Application-level a11y (live regions, focus management across route changes, the feed's list semantics) is in [`performance-and-accessibility.md`](../05-cross-cutting/performance-and-accessibility.md).

---

## 7. Feature components that are _not_ here

For clarity, these live in `features/` and consume `ui/`:

`PostCard`, `PostActions`, `Composer`, `TimelineList`, `ProfileHeader`, `FollowButton`, `NotificationItem`, `SearchInput`.

`FollowButton` is the instructive example: it renders a `ui/Button` but owns a three-state mutation (`follow` / `requested` / `following`), optimistic behaviour, and the private-account path from [`03-flows.md`](../03-flows.md) §8. That is domain logic, and it does not belong in a presentational kit.

---

## 8. Storybook and testing

Every primitive has stories for: default, every variant, disabled, loading, long-content overflow, dark mode, and RTL.

Long-content overflow is listed explicitly because usernames, display names, and hashtags are user-supplied and unbounded within their limits. A layout that only works with "Jane Doe" breaks on a 30-character username — and it always reaches production, because nobody types a 30-character username by hand while developing.

| Layer             | Tool                                |
| ----------------- | ----------------------------------- |
| Visual regression | Chromatic on every PR               |
| Accessibility     | `axe-playwright` per story, CI gate |
| Interaction       | Testing Library, keyboard-first     |
| Contrast          | Token-pair unit test                |
