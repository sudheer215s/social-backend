import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import {
  createConsumer,
  createKafka,
  createProducer,
  startOutboxRelay,
  startReliableConsumer,
} from '@social/platform-events';
import {
  createRedisClient,
  MemorySidRevocationStore,
  NoopSidRevocationStore,
  RedisSidRevocationStore,
  type RedisClient,
  type SidRevocationStore,
} from '@social/platform-redis';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer, Producer } from 'kafkajs';
import type { Pool } from 'pg';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EmailTokenService } from './auth/email-token.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import {
  CounterReconcileService,
  startCounterReconcile,
} from './counters/counter-reconcile.service';
import { CounterService } from './counters/counter.service';
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { ConsoleEmailAdapter } from './email/console-email.adapter';
import { ErasureWorker, startErasureWorker } from './erasure/erasure.worker';
import { HealthController } from './health.controller';
import { createDevKeyRing, JwtKeyRing } from './tokens/jwt-keys';
import { SessionService } from './tokens/session.service';
import { IdentityGrpcController } from './grpc/identity.grpc.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

export const PG_POOL = Symbol('PG_POOL');
export const JWT_KEYS = Symbol('JWT_KEYS');
export const REDIS = Symbol('REDIS');
export const SID_REVOCATION = Symbol('SID_REVOCATION');

@Global()
@Module({
  controllers: [
    AuthController,
    UsersController,
    HealthController,
    IdentityGrpcController,
  ],
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is required for identity-service');
        }
        const rawMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
        const max = Number.isFinite(rawMax)
          ? Math.min(Math.max(Math.floor(rawMax), 1), 10)
          : 5;
        return createPool({ connectionString: url, max });
      },
    },
    {
      provide: REDIS,
      useFactory: (): RedisClient | null => {
        if (process.env.REDIS_DISABLED === '1') {
          return null;
        }
        try {
          return createRedisClient(
            process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          );
        } catch {
          return null;
        }
      },
    },
    {
      provide: SID_REVOCATION,
      inject: [REDIS],
      useFactory: (redis: RedisClient | null): SidRevocationStore => {
        if (process.env.NODE_ENV === 'test' && !redis) {
          return new MemorySidRevocationStore();
        }
        if (!redis) {
          return new NoopSidRevocationStore();
        }
        return new RedisSidRevocationStore(redis);
      },
    },
    {
      provide: JWT_KEYS,
      useFactory: async (): Promise<JwtKeyRing> => createDevKeyRing(),
    },
    ConsoleEmailAdapter,
    {
      provide: HealthService,
      inject: [PG_POOL, REDIS],
      useFactory: (pool: Pool, redis: RedisClient | null) =>
        new HealthService({
          probes: [
            { name: 'postgres', check: () => checkDatabase(pool) },
            {
              name: 'redis',
              check: async () => {
                if (!redis) return process.env.REDIS_DISABLED === '1';
                try {
                  return (await redis.ping()) === 'PONG';
                } catch {
                  return false;
                }
              },
            },
          ],
        }),
    },
    {
      provide: SessionService,
      inject: [PG_POOL, JWT_KEYS, SID_REVOCATION],
      useFactory: (
        pool: Pool,
        keys: JwtKeyRing,
        revocation: SidRevocationStore,
      ) => new SessionService(pool, keys, revocation),
    },
    {
      provide: EmailTokenService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new EmailTokenService(pool),
    },
    {
      provide: AuthService,
      inject: [PG_POOL, SessionService, EmailTokenService, ConsoleEmailAdapter],
      useFactory: (
        pool: Pool,
        sessions: SessionService,
        emailTokens: EmailTokenService,
        email: ConsoleEmailAdapter,
      ) => new AuthService(pool, sessions, emailTokens, email),
    },
    {
      provide: UsersService,
      inject: [PG_POOL, SessionService],
      useFactory: (pool: Pool, sessions: SessionService) =>
        new UsersService(pool, sessions),
    },
    {
      provide: CounterService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new CounterService(pool),
    },
    {
      provide: ErasureWorker,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new ErasureWorker(pool),
    },
    {
      provide: CounterReconcileService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new CounterReconcileService(pool),
    },
    {
      provide: JwtKeyRing,
      inject: [JWT_KEYS],
      useFactory: (keys: JwtKeyRing) => keys,
    },
    JwtAuthGuard,
  ],
  exports: [
    PG_POOL,
    AuthService,
    UsersService,
    JwtKeyRing,
    SessionService,
    ConsoleEmailAdapter,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private producer: Producer | undefined;
  private counterConsumer: Consumer | undefined;
  private stopRelay: (() => void) | undefined;
  private stopCounter: (() => Promise<void>) | undefined;
  private stopErasure: (() => void) | undefined;
  private stopReconcile: (() => void) | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: RedisClient | null,
    @Inject(CounterService) private readonly counters: CounterService,
    @Inject(ErasureWorker) private readonly erasure: ErasureWorker,
    @Inject(CounterReconcileService)
    private readonly reconcile: CounterReconcileService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.IDENTITY_SKIP_MIGRATE !== '1') {
      await applyMigrations(this.pool, defaultMigrationsDir());
    }

    if (process.env.ERASURE_WORKER_DISABLED !== '1') {
      this.stopErasure = startErasureWorker({
        worker: this.erasure,
        intervalMs: Number(process.env.ERASURE_WORKER_INTERVAL_MS ?? 60_000),
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[erasure-worker]', err);
        },
      }).stop;
    }

    if (process.env.COUNTER_RECONCILE_DISABLED !== '1') {
      this.stopReconcile = startCounterReconcile({
        service: this.reconcile,
        intervalMs: Number(
          process.env.COUNTER_RECONCILE_INTERVAL_MS ?? 5 * 60_000,
        ),
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[counter-reconcile]', err);
        },
      }).stop;
    }

    if (process.env.KAFKA_DISABLED === '1') {
      return;
    }
    try {
      const kafka = createKafka('identity-service');
      this.producer = await createProducer(kafka);
      this.stopRelay = startOutboxRelay({
        pool: this.pool,
        schema: 'identity',
        producer: this.producer,
        intervalMs: 500,
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[identity-outbox-relay]', err);
        },
        onPoison: (event, error) => {
          // eslint-disable-next-line no-console
          console.error(
            `[identity-outbox-poison] id=${event.id} type=${event.eventType}`,
            error,
          );
        },
      }).stop;

      this.counterConsumer = await createConsumer(kafka, 'identity-counters');
      this.stopCounter = await startReliableConsumer({
        consumer: this.counterConsumer,
        producer: this.producer,
        topics: ['social.graph.v1', 'social.post.v1'],
        consumerGroup: 'identity-counters',
        handler: async (envelope) => {
          await this.counters.processDomainEvent({
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            payload: envelope.payload,
          });
        },
        onDlq: (info) => {
          // eslint-disable-next-line no-console
          console.error(
            `[identity-counters-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[identity-counters]', err);
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[identity-service] Kafka not fully started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopReconcile?.();
    this.stopErasure?.();
    this.stopRelay?.();
    if (this.stopCounter) await this.stopCounter();
    if (this.producer) {
      await this.producer.disconnect();
    }
    await this.pool.end();
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}
