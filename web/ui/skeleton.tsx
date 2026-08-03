import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Layout-preserving placeholder. Dimensions must match real content (CLS).
 * @see docs/frontend/04-modules/design-system.md §4
 */
export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Accessible label while loading; defaults to "Loading". */
  label?: string;
};

export function Skeleton({
  className,
  label = 'Loading',
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn(
        'animate-pulse rounded-DEFAULT bg-bg-inset',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
