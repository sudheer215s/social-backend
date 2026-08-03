import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionBoundary } from './SessionBoundary';
import { useSessionStore } from './session-store';

describe('SessionBoundary (F1-T01)', () => {
  afterEach(() => {
    cleanup();
    useSessionStore.getState()._reset();
  });

  it('renders nothing while unknown', () => {
    const { container } = render(
      <SessionBoundary requireAuth>
        <p>Private</p>
      </SessionBoundary>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows layout skeleton while bootstrapping', () => {
    useSessionStore.getState().dispatch({ type: 'APP_MOUNT' });
    render(
      <SessionBoundary requireAuth>
        <p>Private</p>
      </SessionBoundary>,
    );
    expect(screen.getByTestId('session-bootstrapping')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading session' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    const s = useSessionStore.getState();
    s.dispatch({ type: 'APP_MOUNT' });
    s.dispatch({ type: 'REFRESH_OK' });
    render(
      <SessionBoundary requireAuth>
        <p>Private</p>
      </SessionBoundary>,
    );
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('keeps children visible while refreshing (transparent)', () => {
    const s = useSessionStore.getState();
    s.dispatch({ type: 'APP_MOUNT' });
    s.dispatch({ type: 'REFRESH_OK' });
    s.dispatch({ type: 'ACCESS_EXPIRED' });
    expect(useSessionStore.getState().status).toBe('refreshing');
    render(
      <SessionBoundary requireAuth>
        <p>Private</p>
      </SessionBoundary>,
    );
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('shows security message when requireAuth and reuse logout', () => {
    const s = useSessionStore.getState();
    s.dispatch({ type: 'APP_MOUNT' });
    s.dispatch({ type: 'REFRESH_OK' });
    s.dispatch({ type: 'ACCESS_EXPIRED' });
    s.dispatch({ type: 'REFRESH_UNAUTHORIZED', reason: 'security' });
    render(
      <SessionBoundary requireAuth fallback={<p>Please log in</p>}>
        <p>Private</p>
      </SessionBoundary>,
    );
    expect(screen.getByText('Please log in')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /signed out for your protection/i,
    );
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
  });
});
