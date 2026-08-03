import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestContext } from './request-context';

let started = false;
let provider: NodeTracerProvider | BasicTracerProvider | undefined;

/**
 * Start OTLP HTTP trace export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
 * No-op if disabled or endpoint missing (local default without Jaeger still works).
 *
 * Call once at process boot *before* binding the HTTP server when possible.
 */
export function startTracing(serviceName: string): void {
  if (started) return;
  if (process.env.OTEL_SDK_DISABLED === '1') return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return;

  const base = endpoint.replace(/\/$/, '');
  // Accept either host:port root or full …/v1/traces
  const url = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;

  try {
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      'service.version': process.env.APP_VERSION ?? '0.0.0-dev',
    });

    const tracerProvider = new NodeTracerProvider({ resource });
    tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url,
        }),
      ),
    );
    tracerProvider.register();
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    provider = tracerProvider;
    started = true;

    const shutdown = () => {
      void provider?.shutdown().catch(() => undefined);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    // Never block boot on telemetry
    console.warn('[otel] failed to start tracing', err);
  }
}

export function isTracingEnabled(): boolean {
  return started;
}

type Next = (err?: unknown) => void;

/**
 * Express middleware: one SERVER span per request, linked to inbound traceparent
 * and our X-Request-Id attribute.
 */
export function httpTracingMiddleware(serviceName?: string) {
  const tracer = trace.getTracer(
    serviceName ?? process.env.SERVICE_NAME ?? 'http',
  );

  return (
    req: IncomingMessage & {
      method?: string;
      url?: string;
      originalUrl?: string;
      path?: string;
      headers: IncomingMessage['headers'];
    },
    res: ServerResponse,
    next: Next,
  ): void => {
    if (!started) {
      next();
      return;
    }

    const pathOnly = (req.originalUrl ?? req.url ?? '/').split('?')[0] ?? '/';
    if (
      pathOnly === '/metrics' ||
      pathOnly === '/health/live' ||
      pathOnly === '/health/ready'
    ) {
      next();
      return;
    }

    const carrier: Record<string, string> = {};
    const tp = req.headers.traceparent;
    if (typeof tp === 'string') carrier.traceparent = tp;
    const ts = req.headers.tracestate;
    if (typeof ts === 'string') carrier.tracestate = ts;

    const parentCtx = propagation.extract(context.active(), carrier);
    const span = tracer.startSpan(
      `${(req.method ?? 'GET').toUpperCase()} ${pathOnly}`,
      {
        kind: 1, // SERVER
        attributes: {
          'http.method': req.method ?? 'GET',
          'http.route': pathOnly,
          'http.target': pathOnly,
        },
      },
      parentCtx,
    );

    const requestId = getRequestContext()?.requestId;
    if (requestId) {
      span.setAttribute('request.id', requestId);
    }

    const spanCtx = trace.setSpan(parentCtx, span);
    const start = Date.now();

    const onFinish = () => {
      res.removeListener('finish', onFinish);
      res.removeListener('close', onFinish);
      span.setAttribute('http.status_code', res.statusCode || 0);
      if ((res.statusCode || 0) >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.setAttribute('http.duration_ms', Date.now() - start);
      span.end();
    };
    res.on('finish', onFinish);
    res.on('close', onFinish);

    context.with(spanCtx, () => next());
  };
}

/** Inject current trace context into outbound HTTP headers. */
export function injectTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  if (!started) return headers;
  const out = { ...headers };
  propagation.inject(context.active(), out);
  return out;
}
