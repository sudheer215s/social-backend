/**
 * problem+json normalisation (RFC 9457).
 * @see docs/frontend/04-modules/api-client.md §6
 */

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Array<{ field: string; message: string }>;
  [key: string]: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  readonly traceId: string | undefined;

  constructor(status: number, problem: Problem, traceId?: string) {
    super(problem.title);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.traceId = traceId ?? problem.traceId;
  }

  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.problem.errors ?? []) {
      out[e.field] = e.message;
    }
    return out;
  }

  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Request deadline exceeded') {
    super(message);
    this.name = 'TimeoutError';
  }
}

const DEFAULT_TYPE = 'about:blank';

/** Build a synthetic Problem when the body is missing or not problem+json. */
export function syntheticProblem(
  status: number,
  title?: string,
  detail?: string,
): Problem {
  return {
    type: DEFAULT_TYPE,
    title: title ?? `HTTP ${status}`,
    status,
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Parse a Response into a typed ApiError.
 * Never throws on body shape — always produces a Problem.
 */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const contentType = res.headers.get('content-type') ?? '';
  let problem: Problem | null = null;

  if (
    contentType.includes('application/problem+json') ||
    contentType.includes('application/json')
  ) {
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object') {
        const o = body as Record<string, unknown>;
        problem = {
          type: typeof o.type === 'string' ? o.type : DEFAULT_TYPE,
          title: typeof o.title === 'string' ? o.title : `HTTP ${res.status}`,
          status: typeof o.status === 'number' ? o.status : res.status,
          ...(typeof o.detail === 'string' ? { detail: o.detail } : {}),
          ...(typeof o.instance === 'string' ? { instance: o.instance } : {}),
          ...(typeof o.traceId === 'string' ? { traceId: o.traceId } : {}),
          ...(Array.isArray(o.errors)
            ? {
                errors: o.errors
                  .filter(
                    (e): e is { field: string; message: string } =>
                      !!e &&
                      typeof e === 'object' &&
                      typeof (e as { field?: unknown }).field === 'string' &&
                      typeof (e as { message?: unknown }).message === 'string',
                  )
                  .map((e) => ({ field: e.field, message: e.message })),
              }
            : {}),
          ...Object.fromEntries(
            Object.entries(o).filter(
              ([k]) =>
                ![
                  'type',
                  'title',
                  'status',
                  'detail',
                  'instance',
                  'traceId',
                  'errors',
                ].includes(k),
            ),
          ),
        };
      }
    } catch {
      problem = null;
    }
  }

  if (!problem) {
    problem = syntheticProblem(
      res.status,
      res.statusText || `HTTP ${res.status}`,
    );
  }

  const headerTrace = res.headers.get('x-trace-id') ?? undefined;
  return new ApiError(res.status, problem, headerTrace ?? problem.traceId);
}
