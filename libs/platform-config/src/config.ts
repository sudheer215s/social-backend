import { z } from 'zod';

/** Keys matching this pattern are never emitted in log-safe JSON. */
const SECRET_KEY_PATTERN = /pass|secret|token|key/i;

/**
 * Shared process configuration. Validated once at boot; the process must not
 * start if validation fails (platform-libraries.md — platform-config).
 *
 * DATABASE_POOL_MAX is capped at 10 in the schema so the connection budget
 * cannot be breached by a mis-set env var (system design §3.6).
 */
export const appConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  SERVICE_NAME: z.string().min(1),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(5),
  REDIS_URL: z.string().url(),
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((raw) =>
      raw
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0),
    )
    .pipe(z.array(z.string().min(1)).min(1)),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export class ConfigValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * Parse and validate configuration from an env-like object.
 * Throws {@link ConfigValidationError} on any failure (fail-fast at boot).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AppConfig {
  const result = appConfigSchema.safeParse(env);
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigValidationError(
      `Invalid configuration: ${summary}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function isSecretConfigKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Produce a log-safe plain object. Any key matching
 * `/pass|secret|token|key/i` is replaced with `[REDACTED]`.
 *
 * @param config - Validated app config (always included)
 * @param extra - Optional additional fields (e.g. raw secrets never to log)
 */
export function configToJSON(
  config: AppConfig,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...config,
    ...extra,
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    out[key] = isSecretConfigKey(key) ? '[REDACTED]' : value;
  }
  return out;
}
