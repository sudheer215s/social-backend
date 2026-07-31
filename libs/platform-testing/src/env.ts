/**
 * Temporarily set process.env keys for the duration of `fn`, then restore.
 * Mutations are restored even if `fn` throws.
 */
export async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** Default local Compose database URL (PgBouncer). */
export const DEFAULT_TEST_DATABASE_URL =
  'postgres://social:social@127.0.0.1:6432/social';

/**
 * Resolve the integration DATABASE_URL, preferring env, then Compose default.
 */
export function getTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/** Minimal env object that satisfies `@social/platform-config` in tests. */
export function validTestConfigEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    NODE_ENV: 'test',
    SERVICE_NAME: 'test-service',
    LOG_LEVEL: 'error',
    DATABASE_URL: DEFAULT_TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '5',
    REDIS_URL: 'redis://127.0.0.1:6379',
    KAFKA_BROKERS: '127.0.0.1:9092',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    ...overrides,
  };
}
