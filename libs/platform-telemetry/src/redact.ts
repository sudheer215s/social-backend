/**
 * Field names redacted at the logger serialiser (platform-libraries.md).
 * Applied centrally so one careless `logger.info({ user })` cannot leak PII.
 */
export const REDACTED_FIELD_NAMES = [
  'password',
  'token',
  'authorization',
  'refresh_token',
  'email',
  'ip',
] as const;

const REDACTED_FIELD_SET = new Set<string>(
  REDACTED_FIELD_NAMES.map((n) => n.toLowerCase()),
);

export const REDACTED_VALUE = '[REDACTED]';

function shouldRedactKey(key: string): boolean {
  return REDACTED_FIELD_SET.has(key.toLowerCase());
}

/**
 * Deep-clone plain objects/arrays, replacing sensitive keys with
 * {@link REDACTED_VALUE}. Non-plain values (Date, Error, etc.) are left as-is
 * when they are not nested under a redacted key.
 */
export function redactSensitive(
  value: unknown,
  depth = 0,
  maxDepth = 8,
): unknown {
  if (depth > maxDepth) {
    return value;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1, maxDepth));
  }
  if (typeof value !== 'object') {
    return value;
  }
  // Leave class instances (Error, Date, …) alone — only plain records.
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    out[key] = shouldRedactKey(key)
      ? REDACTED_VALUE
      : redactSensitive(nested, depth + 1, maxDepth);
  }
  return out;
}
