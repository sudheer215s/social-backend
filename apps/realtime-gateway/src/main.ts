import { NestFactory } from '@nestjs/core';
import { createLogger } from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'realtime-gateway',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  // Long-lived SSE connections — disable request timeout at Nest level
  const port = process.env.PORT ?? '3007';
  await app.listen(port);
  log.info({ port }, 'realtime-gateway listening');
}

void bootstrap();
