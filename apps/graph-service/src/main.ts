import { NestFactory } from '@nestjs/core';
import { createLogger } from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'graph-service',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const port = process.env.PORT ?? '3003';
  await app.listen(port);
  log.info({ port }, 'graph-service listening');
}

void bootstrap();
