/**
 * Single cache-key registry — no ad-hoc queryKey literals in features.
 * @see docs/frontend/04-modules/data-layer.md
 */
export const queryKeys = {
  session: ['session'] as const,
  me: ['me'] as const,
  timelineHome: () => ['timeline', 'home'] as const,
  /** Head-only poll for the new-posts pill; never merged into the list cache. */
  timelineHead: () => ['timeline', 'home', 'head'] as const,
  timelineUser: (id: string) => ['timeline', 'user', id] as const,
};
