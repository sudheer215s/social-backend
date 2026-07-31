import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Returns true when the Docker CLI can talk to a running daemon.
 * Used to soft-skip Testcontainers / Compose-dependent suites in CI without Docker.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Jest helper: if Docker is unavailable, mark remaining tests in the suite as skipped.
 * Call from `beforeAll`.
 *
 * @returns whether Docker is available
 */
export async function skipIfNoDocker(
  ctx: { skip: () => void },
  reason = 'Docker daemon not available',
): Promise<boolean> {
  const ok = await isDockerAvailable();
  if (!ok) {
    console.warn(`Skipping tests: ${reason}`);
    ctx.skip();
  }
  return ok;
}
