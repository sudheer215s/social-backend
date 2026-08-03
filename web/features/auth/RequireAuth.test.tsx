import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { useSessionStore } from './session-store';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/home',
}));

describe('RequireAuth (F1-T03)', () => {
  beforeEach(() => {
    replace.mockClear();
    useSessionStore.getState()._reset();
  });

  afterEach(() => {
    useSessionStore.getState()._reset();
  });

  it('renders nothing while unknown', () => {
    const { container } = render(
      <RequireAuth>
        <p>Secret</p>
      </RequireAuth>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects anonymous users to /login?next=/home', () => {
    const s = useSessionStore.getState();
    s.dispatch({ type: 'APP_MOUNT' });
    s.dispatch({ type: 'REFRESH_UNAUTHORIZED' });

    render(
      <RequireAuth>
        <p>Secret</p>
      </RequireAuth>,
    );

    expect(replace).toHaveBeenCalledWith('/login?next=%2Fhome');
    expect(screen.getByTestId('require-auth-redirecting')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    const s = useSessionStore.getState();
    s.dispatch({ type: 'APP_MOUNT' });
    s.dispatch({ type: 'REFRESH_OK' });

    render(
      <RequireAuth>
        <p>Secret</p>
      </RequireAuth>,
    );

    expect(screen.getByText('Secret')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
