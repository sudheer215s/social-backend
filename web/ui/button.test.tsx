import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button (F0-T09)', () => {
  it('renders a native button with accessible name', () => {
    render(<Button>Log in</Button>);
    const btn = screen.getByRole('button', { name: 'Log in' });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('applies primary variant classes', () => {
    render(<Button variant="primary">Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn.className).toMatch(/bg-accent/);
    expect(btn.className).toMatch(/min-h-tap/);
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('supports asChild for link composition', () => {
    render(
      <Button asChild variant="primary">
        <a href="/login">Log in</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link.className).toMatch(/bg-accent/);
  });
});
