import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrefetchSentinel } from './PrefetchSentinel';

type Trigger = () => void;

/** jsdom has no IntersectionObserver; this one lets a test decide when to fire. */
function stubObserver() {
  const triggers: Trigger[] = [];
  const observed: Element[] = [];
  const disconnect = vi.fn();

  class StubIntersectionObserver {
    constructor(private cb: IntersectionObserverCallback) {
      triggers.push(() => {
        this.cb(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      });
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect = disconnect;
  }

  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
  return { triggers, observed, disconnect };
}

describe('PrefetchSentinel (F2-T04)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls back when the sentinel scrolls into view', () => {
    const { triggers } = stubObserver();
    const onReach = vi.fn();

    render(<PrefetchSentinel onReach={onReach} />);
    triggers[0]?.();

    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('observes the element it renders', () => {
    const { observed } = stubObserver();

    render(<PrefetchSentinel onReach={vi.fn()} />);

    expect(observed[0]).toBe(screen.getByTestId('prefetch-sentinel'));
  });

  it('does not observe while disabled', () => {
    const { observed } = stubObserver();

    render(<PrefetchSentinel onReach={vi.fn()} disabled />);

    expect(observed).toHaveLength(0);
  });

  it('disconnects on unmount so a scrolled-away sentinel stops firing', () => {
    const { disconnect } = stubObserver();

    render(<PrefetchSentinel onReach={vi.fn()} />).unmount();

    expect(disconnect).toHaveBeenCalled();
  });

  it('uses the latest callback without re-observing', () => {
    const { triggers, observed } = stubObserver();
    const first = vi.fn();
    const second = vi.fn();

    const view = render(<PrefetchSentinel onReach={first} />);
    view.rerender(<PrefetchSentinel onReach={second} />);
    triggers[0]?.();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(observed).toHaveLength(1);
  });

  it('renders nothing observable to assistive tech', () => {
    stubObserver();

    render(<PrefetchSentinel onReach={vi.fn()} />);

    expect(screen.getByTestId('prefetch-sentinel')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
