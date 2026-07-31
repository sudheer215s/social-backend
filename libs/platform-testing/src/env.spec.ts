import {
  DEFAULT_TEST_DATABASE_URL,
  getTestDatabaseUrl,
  validTestConfigEnv,
  withEnv,
} from './env';

describe('withEnv', () => {
  it('sets and restores environment variables', async () => {
    const original = process.env.PLATFORM_TESTING_PROBE;
    delete process.env.PLATFORM_TESTING_PROBE;

    await withEnv({ PLATFORM_TESTING_PROBE: 'one' }, () => {
      expect(process.env.PLATFORM_TESTING_PROBE).toBe('one');
    });
    expect(process.env.PLATFORM_TESTING_PROBE).toBeUndefined();

    process.env.PLATFORM_TESTING_PROBE = 'keep';
    await withEnv({ PLATFORM_TESTING_PROBE: 'two' }, () => {
      expect(process.env.PLATFORM_TESTING_PROBE).toBe('two');
    });
    expect(process.env.PLATFORM_TESTING_PROBE).toBe('keep');

    if (original === undefined) {
      delete process.env.PLATFORM_TESTING_PROBE;
    } else {
      process.env.PLATFORM_TESTING_PROBE = original;
    }
  });

  it('restores env even when fn throws', async () => {
    process.env.PLATFORM_TESTING_PROBE = 'base';
    await expect(
      withEnv({ PLATFORM_TESTING_PROBE: 'temp' }, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(process.env.PLATFORM_TESTING_PROBE).toBe('base');
    delete process.env.PLATFORM_TESTING_PROBE;
  });
});

describe('getTestDatabaseUrl', () => {
  it('prefers DATABASE_URL from env', () => {
    expect(getTestDatabaseUrl({ DATABASE_URL: 'postgres://x/y' })).toBe(
      'postgres://x/y',
    );
  });

  it('falls back to Compose default', () => {
    expect(getTestDatabaseUrl({})).toBe(DEFAULT_TEST_DATABASE_URL);
  });
});

describe('validTestConfigEnv', () => {
  it('includes required platform-config keys', () => {
    const env = validTestConfigEnv({ SERVICE_NAME: 'custom' });
    expect(env.NODE_ENV).toBe('test');
    expect(env.SERVICE_NAME).toBe('custom');
    expect(env.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(env.KAFKA_BROKERS).toBeTruthy();
  });
});
