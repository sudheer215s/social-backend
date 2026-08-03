import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './skeleton';

describe('Skeleton (F0-T09)', () => {
  it('exposes a busy status with accessible label', () => {
    render(<Skeleton className="h-4 w-32" label="Loading post" />);
    const el = screen.getByRole('status', { name: 'Loading post' });
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el.className).toMatch(/animate-pulse/);
    expect(el.className).toMatch(/h-4/);
  });

  it('defaults label to Loading', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
