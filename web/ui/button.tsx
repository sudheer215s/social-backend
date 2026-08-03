import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Button primitive — zero app knowledge.
 * @see docs/frontend/04-modules/design-system.md §3
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-DEFAULT font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:opacity-90 no-underline',
        secondary: 'bg-bg-inset text-fg hover:bg-bg-subtle no-underline',
        ghost: 'bg-transparent text-fg hover:bg-bg-subtle no-underline',
        danger: 'bg-danger text-white hover:opacity-90 no-underline',
      },
      size: {
        sm: 'h-9 min-h-tap min-w-tap px-3 text-sm',
        md: 'h-11 min-h-tap min-w-tap px-4 text-sm',
        lg: 'h-12 min-h-tap px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as child (e.g. Next Link) while keeping button styles. */
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, asChild = false, type, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        {...props}
      />
    );
  },
);
