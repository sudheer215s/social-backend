import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { createRedisClient, type RedisClient } from '@social/platform-redis';
import { HealthService } from '@social/platform-telemetry';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard } from './auth/jwt.guard';
import { HealthController } from './health.controller';
import { RealtimeController } from './realtime/realtime.controller';
import { TicketService } from './ticket/ticket.service';
import { INSTANCE_ID, REDIS } from './tokens';

export { INSTANCE_ID, REDIS } from './tokens';

@Global()
@Module({
  controllers: [RealtimeController, HealthController],
  providers: [
    {
      provide: INSTANCE_ID,
      useFactory: () => process.env.INSTANCE_ID ?? randomUUID().slice(0, 8),
    },
    {
      provide: REDIS,
      useFactory: (): RedisClient =>
        createRedisClient(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'),
    },
    {
      provide: TicketService,
      inject: [REDIS, INSTANCE_ID],
      useFactory: (redis: RedisClient, instanceId: string) =>
        new TicketService(redis, instanceId),
    },
    {
      provide: HealthService,
      inject: [REDIS],
      useFactory: (redis: RedisClient) =>
        new HealthService({
          probes: [
            {
              name: 'redis',
              check: async () => {
                try {
                  const pong = await redis.ping();
                  return pong === 'PONG';
                } catch {
                  return false;
                }
              },
            },
          ],
        }),
    },
    JwtAuthGuard,
  ],
  exports: [REDIS, TicketService],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
