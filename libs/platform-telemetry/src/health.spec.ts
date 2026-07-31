import { HealthService, readyHttpStatus } from './health';

describe('HealthService', () => {
  it('live is always ok and does not call dependency probes', () => {
    let called = false;
    const health = new HealthService({
      probes: [
        {
          name: 'db',
          check: () => {
            called = true;
            return false;
          },
        },
      ],
    });

    expect(health.live()).toEqual({ status: 'ok' });
    expect(called).toBe(false);
  });

  it('ready reports ok when all probes pass', async () => {
    const health = new HealthService({
      probes: [
        { name: 'db', check: () => true },
        { name: 'redis', check: () => Promise.resolve(true) },
      ],
    });

    await expect(health.ready()).resolves.toEqual({
      status: 'ok',
      checks: { db: 'up', redis: 'up' },
    });
  });

  it('ready is degraded when some probes fail', async () => {
    const health = new HealthService({
      probes: [
        { name: 'db', check: () => true },
        { name: 'redis', check: () => false },
      ],
    });

    await expect(health.ready()).resolves.toEqual({
      status: 'degraded',
      checks: { db: 'up', redis: 'down' },
    });
  });

  it('ready is unavailable when all probes fail or throw', async () => {
    const health = new HealthService({
      probes: [
        { name: 'db', check: () => false },
        {
          name: 'redis',
          check: () => {
            throw new Error('boom');
          },
        },
      ],
    });

    await expect(health.ready()).resolves.toEqual({
      status: 'unavailable',
      checks: { db: 'down', redis: 'down' },
    });
  });

  it('caches ready results for readyCacheMs', async () => {
    let now = 1_000;
    let calls = 0;
    const health = new HealthService({
      readyCacheMs: 5_000,
      now: () => now,
      probes: [
        {
          name: 'db',
          check: () => {
            calls += 1;
            return true;
          },
        },
      ],
    });

    await health.ready();
    await health.ready();
    expect(calls).toBe(1);

    now = 1_000 + 4_999;
    await health.ready();
    expect(calls).toBe(1);

    now = 1_000 + 5_000;
    await health.ready();
    expect(calls).toBe(2);
  });

  it('readyHttpStatus maps unavailable to 503', () => {
    expect(readyHttpStatus({ status: 'ok', checks: {} })).toBe(200);
    expect(
      readyHttpStatus({ status: 'degraded', checks: { db: 'down' } }),
    ).toBe(200);
    expect(
      readyHttpStatus({ status: 'unavailable', checks: { db: 'down' } }),
    ).toBe(503);
  });
});
