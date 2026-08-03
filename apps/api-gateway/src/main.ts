import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  httpMetricsMiddleware,
  httpTracingMiddleware,
  requestContextMiddleware,
  startTracing,
} from '@social/platform-telemetry';
import {
  createRedisClient,
  MemoryFixedWindowRateLimiter,
  RedisFixedWindowRateLimiter,
  type RateLimiter,
  type RedisClient,
} from '@social/platform-redis';
import express from 'express';
import { AppModule } from './app.module';
import { createAnonRateLimitMiddleware } from './rate-limit/anon-rate-limit.middleware';
import {
  configureCorsOrigins,
  securityHeadersMiddleware,
} from './security/security.middleware';

async function bootstrap(): Promise<void> {
  const serviceName = process.env.SERVICE_NAME ?? 'api-gateway';
  startTracing(serviceName);
  const log = createLogger({
    serviceName,
    level: (process.env.LOG_LEVEL as 'info') ?? 'info',
  });

  const jsonLimit = process.env.JSON_BODY_LIMIT ?? '100kb';
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  // Design §2: reject oversized JSON early (default 100 KB).
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: true, limit: jsonLimit }));

  const corsOrigin = configureCorsOrigins();
  if (corsOrigin !== false) {
    app.enableCors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-Id',
        'traceparent',
      ],
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
        'Idempotent-Replay',
      ],
    });
  }

  // Correlation first so metrics/rate-limit see the same request id context.
  app.use(requestContextMiddleware());
  app.use(httpTracingMiddleware());
  app.use(securityHeadersMiddleware());
  app.use(httpMetricsMiddleware());

  // Anonymous IP rate limit (trusted XFF only) — fail-open if Redis down.
  let redis: RedisClient | null = null;
  let limiter: RateLimiter = new MemoryFixedWindowRateLimiter();
  if (process.env.REDIS_DISABLED !== '1') {
    try {
      redis = createRedisClient(
        process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      limiter = new RedisFixedWindowRateLimiter(redis, 'gw-rl:');
    } catch {
      log.warn('anon rate limit using memory limiter');
    }
  }
  app.use(createAnonRateLimitMiddleware(limiter));

  const port = process.env.PORT ?? '3000';
  await app.listen(port);
  log.info({ port }, 'api-gateway listening');
}

void bootstrap();
