import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  ConfigValidationError,
  configToJSON,
  loadConfig,
} from '@social/platform-config';
import {
  createLogger,
  httpMetricsMiddleware,
  requestContextMiddleware,
} from '@social/platform-telemetry';
import path from 'node:path';
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
  app.use(requestContextMiddleware());
  app.use(httpMetricsMiddleware());

  const grpcUrl = process.env.IDENTITY_GRPC_URL ?? '0.0.0.0:50051';
  const protoPath = path.join(
    process.cwd(),
    '../../proto/identity/v1/identity.proto',
  );
  // When running from apps/identity-service, cwd is package root
  const protoCandidates = [
    path.join(process.cwd(), 'proto/identity/v1/identity.proto'),
    path.join(process.cwd(), '../../proto/identity/v1/identity.proto'),
    path.resolve(__dirname, '../../../proto/identity/v1/identity.proto'),
  ];
  const { existsSync } = await import('node:fs');
  const resolvedProto = protoCandidates.find((p) => existsSync(p)) ?? protoPath;

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'identity.v1',
      protoPath: resolvedProto,
      url: grpcUrl,
    },
  });

  await app.startAllMicroservices();
  const port = process.env.PORT ?? '3001';
  await app.listen(port);
  log.info(
    { port, grpcUrl, proto: resolvedProto },
    'identity-service listening',
  );
}

void bootstrap();
