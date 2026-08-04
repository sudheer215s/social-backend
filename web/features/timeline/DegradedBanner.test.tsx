import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { degradation } from '@/api-client';
import { DegradedBanner } from './DegradedBanner';

function report(scopes: string[]) {
  act(() => {
    degradation.report(scopes);
  });
}

describe('DegradedBanner (F2-T03)', () => {
  afterEach(() => {
    degradation._reset();
  });

  it('renders nothing until something is degraded', () => {
    const { container } = render(<DegradedBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names what is stale rather than failing the screen', async () => {
    render(<DegradedBanner />);
    report(['timeline-pull']);

    expect(await screen.findByTestId('degraded-banner')).toHaveTextContent(
      /some posts may be missing/i,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('maps post-hydration to its own message', async () => {
    render(<DegradedBanner />);
    report(['post-hydration']);

    expect(await screen.findByTestId('degraded-banner')).toHaveTextContent(
      /some posts couldn't be loaded/i,
    );
  });

  it('names every degraded scope at once', async () => {
    render(<DegradedBanner />);
    report(['timeline-pull', 'post-hydration']);

    const banner = await screen.findByTestId('degraded-banner');
    expect(banner).toHaveTextContent(/some posts may be missing/i);
    expect(banner).toHaveTextContent(/some posts couldn't be loaded/i);
  });

  it('falls back to generic copy for a scope it does not know', async () => {
    render(<DegradedBanner />);
    report(['something-new']);

    expect(await screen.findByTestId('degraded-banner')).toHaveTextContent(
      /some information may be out of date/i,
    );
  });

  it('is dismissible and stays dismissed for the same scope', async () => {
    const user = userEvent.setup();
    render(<DegradedBanner />);
    report(['timeline-pull']);

    await user.click(await screen.findByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('degraded-banner')).toBeNull();

    report(['timeline-pull']);
    expect(screen.queryByTestId('degraded-banner')).toBeNull();
  });

  it('reappears when a different scope degrades after a dismissal', async () => {
    const user = userEvent.setup();
    render(<DegradedBanner />);
    report(['timeline-pull']);

    await user.click(await screen.findByRole('button', { name: /dismiss/i }));
    report(['post-hydration']);

    expect(await screen.findByTestId('degraded-banner')).toHaveTextContent(
      /couldn't be loaded/i,
    );
  });
});
