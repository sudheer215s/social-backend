import { NestFactory } from '@nestjs/core';
import type { RedisClient } from '@social/platform-redis';
import {
  createLogger,
  httpMetricsMiddleware,
  requestContextMiddleware,
} from '@social/platform-telemetry';
import { AppModule, REDIS } from './app.module';
import { attachRealtimeWebSocket } from './realtime/ws.gateway';
import { TicketService } from './ticket/ticket.service';

async function bootstrap(): Promise<void> {
  const log = createLogger({
    serviceName: process.env.SERVICE_NAME ?? 'realtime-gateway',
    level: 'info',
  });
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.use(requestContextMiddleware());
  app.use(httpMetricsMiddleware());
  const port = process.env.PORT ?? '3007';
  await app.listen(port);

  const httpServer = app.getHttpServer() as import('node:http').Server;
  const redis = app.get<RedisClient>(REDIS);
  const tickets = app.get(TicketService);
  attachRealtimeWebSocket({ server: httpServer, redis, tickets });

  log.info({ port }, 'realtime-gateway listening (SSE + WebSocket)');
}

void bootstrap();
