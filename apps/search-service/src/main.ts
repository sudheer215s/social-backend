import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  httpMetricsMiddleware,
  requestContextMiddleware,
} from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'search-service',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.use(requestContextMiddleware());
  app.use(httpMetricsMiddleware());
  const port = process.env.PORT ?? '3006';
  await app.listen(port);
  log.info({ port }, 'search-service listening');
}

void bootstrap();
