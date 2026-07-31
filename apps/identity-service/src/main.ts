import { NestFactory } from '@nestjs/core';
import {
  ConfigValidationError,
  configToJSON,
  loadConfig,
} from '@social/platform-config';
import { createLogger } from '@social/platform-telemetry';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const log = createLogger({
    serviceName: config.SERVICE_NAME,
    level: config.LOG_LEVEL,
  });
  log.info({ config: configToJSON(config) }, 'boot: config validated');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const port = process.env.PORT ?? '3001';
  await app.listen(port);
  log.info({ port }, 'identity-service listening');
}

void bootstrap();
