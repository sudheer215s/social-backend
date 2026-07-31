export interface WaitForOptions {
  /** Total time to wait before failing. Default 5s. */
  timeoutMs?: number;
  /** Delay between attempts. Default 50ms. */
  intervalMs?: number;
  /** Label included in the timeout error. */
  description?: string;
}

/**
 * Poll `fn` until it returns a truthy value or the timeout elapses.
 * Useful for readiness of Compose services and async side effects in tests.
 */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const description = options.description ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }

  let suffix = '';
  if (lastError instanceof Error) {
    suffix = `: last error: ${lastError.message}`;
  } else if (lastError !== undefined && lastError !== null) {
    suffix = `: last error: ${JSON.stringify(lastError)}`;
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms waiting for ${description}${suffix}`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
