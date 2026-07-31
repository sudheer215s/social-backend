import { PoolConfigError, createPool, MAX_POOL_SIZE } from './pool';

describe('createPool', () => {
  const connectionString = 'postgres://social:social@localhost:6432/social';

  it('rejects max above the hard cap', () => {
    expect(() =>
      createPool({ connectionString, max: MAX_POOL_SIZE + 1 }),
    ).toThrow(PoolConfigError);
  });

  it('rejects non-positive max', () => {
    expect(() => createPool({ connectionString, max: 0 })).toThrow(
      PoolConfigError,
    );
  });

  it('creates a pool with the requested max when within cap', async () => {
    const pool = createPool({ connectionString, max: 3 });
    expect(pool.options.max).toBe(3);
    await pool.end();
  });

  it('defaults max to 5', async () => {
    const pool = createPool({ connectionString });
    expect(pool.options.max).toBe(5);
    await pool.end();
  });
});
