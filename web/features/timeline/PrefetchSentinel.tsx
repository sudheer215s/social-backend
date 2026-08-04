'use client';

import { useEffect, useRef } from 'react';

export type PrefetchSentinelProps = {
  onReach: () => void;
  disabled?: boolean;
};

/**
 * Sits *inside* the list rather than after it, so the next page is requested
 * while the reader still has posts left to read.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 */
export function PrefetchSentinel({ onReach, disabled }: PrefetchSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onReach);

  useEffect(() => {
    latest.current = onReach;
  }, [onReach]);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    // No IntersectionObserver (older Safari, SSR smoke tests): the explicit
    // "Load more" control below the list is the fallback.
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [disabled]);

  return <div ref={ref} aria-hidden="true" data-testid="prefetch-sentinel" />;
}
