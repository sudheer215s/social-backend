import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPage from './page';

describe('LandingPage (F0-T01)', () => {
  it('renders the product name and primary auth links', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Social' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/register',
    );
  });
});
