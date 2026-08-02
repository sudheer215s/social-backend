import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  httpRequestDurationSeconds,
  httpRequestErrorsTotal,
  httpRequestsTotal,
  normalizeHttpRoute,
  statusClass,
} from './metrics';

type Next = (err?: unknown) => void;

const SKIP = new Set(['/metrics', '/health/live', '/health/ready']);

/**
 * Express-compatible middleware: records RED metrics for HTTP requests.
 * Safe for NestJS (Express adapter). Skips health and metrics scrapes.
 */
export function httpMetricsMiddleware() {
  return (
    req: IncomingMessage & { originalUrl?: string; url?: string },
    res: ServerResponse,
    next: Next,
  ): void => {
    const raw = req.originalUrl ?? req.url ?? '/';
    const pathOnly = raw.split('?')[0] ?? '/';
    if (SKIP.has(pathOnly)) {
      next();
      return;
    }

    const start = process.hrtime.bigint();
    const method = (req.method ?? 'GET').toUpperCase();

    res.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - start;
      const seconds = Number(elapsedNs) / 1e9;
      const route = normalizeHttpRoute(pathOnly);
      const code = res.statusCode || 0;
      const sc = statusClass(code);
      httpRequestsTotal.inc(1, { method, route, status_class: sc });
      httpRequestDurationSeconds.observe(seconds, {
        method,
        route,
        status_class: sc,
      });
      if (code >= 500) {
        httpRequestErrorsTotal.inc(1, { method, route });
      }
    });

    next();
  };
}
