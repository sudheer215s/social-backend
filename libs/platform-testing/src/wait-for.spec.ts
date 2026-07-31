import { sleep, waitFor } from './wait-for';

describe('waitFor', () => {
  it('resolves when the predicate becomes truthy', async () => {
    let n = 0;
    const value = await waitFor(
      () => {
        n += 1;
        return n >= 3 ? 'ready' : undefined;
      },
      { intervalMs: 5, timeoutMs: 1_000 },
    );
    expect(value).toBe('ready');
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('throws after timeout with description', async () => {
    await expect(
      waitFor(() => false, {
        timeoutMs: 40,
        intervalMs: 10,
        description: 'never ready',
      }),
    ).rejects.toThrow(/never ready/);
  });

  it('retries after thrown errors until success', async () => {
    let n = 0;
    const value = await waitFor(
      () => {
        n += 1;
        if (n < 2) {
          throw new Error('not yet');
        }
        return 'ok';
      },
      { intervalMs: 5, timeoutMs: 1_000 },
    );
    expect(value).toBe('ok');
  });
});

describe('sleep', () => {
  it('waits approximately the requested duration', async () => {
    const start = Date.now();
    await sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});
