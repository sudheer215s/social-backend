import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  requestId: string;
  traceparent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Validate W3C traceparent (version-traceid-spanid-flags). */
export function parseTraceparent(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  // 00-<32 hex>-<16 hex>-<2 hex>
  if (
    !/^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(v) ||
    v.length > 55
  ) {
    return undefined;
  }
  return v.toLowerCase();
}

export function sanitizeRequestId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (v.length < 8 || v.length > 128) return undefined;
  if (!/^[\w.:@+/-]+$/.test(v)) return undefined;
  return v;
}

type Next = (err?: unknown) => void;

/**
 * Express middleware: assign X-Request-Id (or accept inbound), echo it,
 * and store optional W3C traceparent for upstream propagation.
 */
export function requestContextMiddleware() {
  return (
    req: IncomingMessage & {
      headers: IncomingMessage['headers'];
      originalUrl?: string;
    },
    res: ServerResponse,
    next: Next,
  ): void => {
    const inbound =
      sanitizeRequestId(req.headers['x-request-id']) ??
      sanitizeRequestId(req.headers['x-correlation-id']);
    const requestId = inbound ?? randomUUID();
    const traceparent = parseTraceparent(req.headers['traceparent']);
    const ctx: RequestContext = {
      requestId,
      ...(traceparent ? { traceparent } : {}),
    };
    res.setHeader('X-Request-Id', requestId);
    if (traceparent) {
      res.setHeader('traceparent', traceparent);
    }
    storage.run(ctx, () => next());
  };
}

/** Headers to attach on outbound service-to-service HTTP calls. */
export function outboundRequestHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const ctx = getRequestContext();
  const headers = { ...extra };
  if (ctx?.requestId) {
    headers['x-request-id'] = ctx.requestId;
  }
  if (ctx?.traceparent) {
    headers.traceparent = ctx.traceparent;
  }
  return headers;
}
