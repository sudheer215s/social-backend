import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  httpMetricsMiddleware,
  httpTracingMiddleware,
  requestContextMiddleware,
  startTracing,
} from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  startTracing(process.env.SERVICE_NAME ?? 'timeline-service');
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'timeline-service',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.use(requestContextMiddleware());
  app.use(httpTracingMiddleware());
  app.use(httpMetricsMiddleware());
  const port = process.env.PORT ?? '3004';
  await app.listen(port);
  log.info({ port }, 'timeline-service listening');
}

void bootstrap();
