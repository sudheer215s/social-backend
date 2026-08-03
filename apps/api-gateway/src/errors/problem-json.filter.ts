import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestContext } from '@social/platform-telemetry';

export const PROBLEM_JSON = 'application/problem+json';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: unknown;
  [key: string]: unknown;
}

const DEFAULT_TYPE = 'about:blank';

/**
 * RFC 9457 problem+json for every non-2xx from the gateway.
 * Preserves structured bodies that already look like problem details.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly log = new Logger(ProblemJsonFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = toProblem(exception, req);
    if (problem.status >= 500) {
      this.log.error(
        `status=${problem.status} path=${req.url} detail=${problem.detail ?? ''}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (!res.headersSent) {
      res.setHeader('Content-Type', PROBLEM_JSON);
      res.status(problem.status).json(problem);
    }
  }
}

export function toProblem(exception: unknown, req: Request): ProblemDetails {
  const instance = req.originalUrl || req.url || '/';
  const traceId =
    getRequestContext()?.requestId ??
    headerString(req.headers['x-request-id']) ??
    undefined;

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const raw = exception.getResponse();
    if (typeof raw === 'string') {
      return base(status, raw, instance, traceId);
    }
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      // Already problem-shaped
      if (typeof o.type === 'string' && typeof o.title === 'string') {
        return {
          ...o,
          type: o.type,
          title: o.title,
          status: typeof o.status === 'number' ? o.status : status,
          instance: typeof o.instance === 'string' ? o.instance : instance,
          ...(traceId && o.traceId === undefined ? { traceId } : {}),
        };
      }
      const message = o.message;
      const detail =
        typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? message.map(String).join('; ')
            : exception.message;
      const title =
        typeof o.error === 'string' ? o.error : (HttpStatus[status] ?? 'Error');
      const problem: ProblemDetails = {
        type: DEFAULT_TYPE,
        title: String(title),
        status,
        detail,
        instance,
        ...(traceId ? { traceId } : {}),
      };
      if (o.errors !== undefined) problem.errors = o.errors;
      if (typeof o.type === 'string') problem.type = o.type;
      if (typeof o.title === 'string') problem.title = o.title;
      if (typeof o.detail === 'string') problem.detail = o.detail;
      return problem;
    }
  }

  return base(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'An unexpected error occurred',
    instance,
    traceId,
  );
}

function base(
  status: number,
  detail: string,
  instance: string,
  traceId?: string,
): ProblemDetails {
  return {
    type: DEFAULT_TYPE,
    title: HttpStatus[status] ?? 'Error',
    status,
    detail,
    instance,
    ...(traceId ? { traceId } : {}),
  };
}

function headerString(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return undefined;
}
