/**
 * Single cache-key registry — no ad-hoc queryKey literals in features.
 * @see docs/frontend/04-modules/data-layer.md
 */
export const queryKeys = {
  session: ['session'] as const,
  me: ['me'] as const,
};
