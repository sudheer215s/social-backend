import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  httpMetricsMiddleware,
  requestContextMiddleware,
} from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'post-service',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.use(requestContextMiddleware());
  app.use(httpMetricsMiddleware());
  const port = process.env.PORT ?? '3002';
  await app.listen(port);
  log.info({ port }, 'post-service listening');
}

void bootstrap();
