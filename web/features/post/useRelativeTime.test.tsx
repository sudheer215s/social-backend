import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TICK_INTERVAL_MS, useRelativeTime } from './useRelativeTime';

function Stamp({ iso }: { iso: string }) {
  return <span data-testid="stamp">{useRelativeTime(iso)}</span>;
}

describe('useRelativeTime (F2-T02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs one interval for a hundred cards, not a hundred intervals', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const iso = new Date(Date.now() - 60_000).toISOString();

    render(
      <>
        {Array.from({ length: 100 }, (_, i) => (
          <Stamp key={i} iso={iso} />
        ))}
      </>,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('stamp')).toHaveLength(100);
  });

  it('stops the interval when the last subscriber unmounts', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const iso = new Date(Date.now() - 60_000).toISOString();

    const first = render(<Stamp iso={iso} />);
    const second = render(<Stamp iso={iso} />);

    first.unmount();
    expect(clear).not.toHaveBeenCalled();

    second.unmount();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('re-renders subscribers when the shared tick fires', () => {
    const iso = new Date(Date.now() - 59_000).toISOString();
    render(<Stamp iso={iso} />);
    expect(screen.getByTestId('stamp')).toHaveTextContent('now');

    act(() => {
      vi.advanceTimersByTime(TICK_INTERVAL_MS);
    });

    expect(screen.getByTestId('stamp')).toHaveTextContent('1m');
  });
});
