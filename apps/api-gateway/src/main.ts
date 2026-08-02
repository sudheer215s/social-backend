import { NestFactory } from '@nestjs/core';
import {
  createLogger,
  httpMetricsMiddleware,
} from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const serviceName = process.env.SERVICE_NAME ?? 'api-gateway';
  const log = createLogger({
    serviceName,
    level: (process.env.LOG_LEVEL as 'info') ?? 'info',
  });

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.use(httpMetricsMiddleware());
  const port = process.env.PORT ?? '3000';
  await app.listen(port);
  log.info({ port }, 'api-gateway listening');
}

void bootstrap();
