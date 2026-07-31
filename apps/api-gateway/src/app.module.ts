import { Module } from '@nestjs/common';
import {
  createRedisClient,
  MemoryFixedWindowRateLimiter,
  MemorySidRevocationStore,
  NoopSidRevocationStore,
  RedisFixedWindowRateLimiter,
  RedisSidRevocationStore,
  type RateLimiter,
  type RedisClient,
  type SidRevocationStore,
} from '@social/platform-redis';
import { HealthService } from '@social/platform-telemetry';
import { AuthController } from './auth/auth.controller';
import { ContentController } from './content/content.controller';
import { AuthGuard } from './auth/auth.guard';
import { JwtVerifier } from './auth/jwt-verifier';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { IdentityGrpcClient } from './proxy/identity.grpc.client';
import { IdentityProxy } from './proxy/identity.proxy';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RATE_LIMITER, REDIS, SID_REVOCATION } from './tokens';

@Module({
  controllers: [
    AuthController,
    ContentController,
    HealthController,
    MetricsController,
  ],
  providers: [
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
      provide: HealthService,
      inject: [REDIS],
      useFactory: (redis: RedisClient | null) =>
        new HealthService({
          probes: [
            {
              name: 'redis',
              check: async () => {
                // Memory fallbacks exist when redis is absent; only probe if connected.
                if (!redis) return true;
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
      provide: SID_REVOCATION,
      inject: [REDIS],
      useFactory: (redis: RedisClient | null): SidRevocationStore => {
        if (!redis) {
          return process.env.NODE_ENV === 'test'
            ? new MemorySidRevocationStore()
            : new NoopSidRevocationStore();
        }
        return new RedisSidRevocationStore(redis);
      },
    },
    {
      provide: RATE_LIMITER,
      inject: [REDIS],
      useFactory: (redis: RedisClient | null): RateLimiter => {
        if (!redis) {
          return new MemoryFixedWindowRateLimiter();
        }
        return new RedisFixedWindowRateLimiter(redis, 'gw-rl:');
      },
    },
    {
      provide: JwtVerifier,
      useFactory: () =>
        new JwtVerifier({
          jwksUrl:
            process.env.IDENTITY_JWKS_URL ??
            'http://127.0.0.1:3001/.well-known/jwks.json',
          issuer: process.env.JWT_ISSUER ?? 'http://localhost:3001',
          audience: process.env.JWT_AUDIENCE ?? 'api',
        }),
    },
    {
      provide: IdentityProxy,
      useFactory: () =>
        new IdentityProxy(
          process.env.IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001',
        ),
    },
    {
      provide: IdentityGrpcClient,
      useFactory: () =>
        new IdentityGrpcClient(
          process.env.IDENTITY_GRPC_URL ?? '127.0.0.1:50051',
        ),
    },
    {
      provide: AuthGuard,
      inject: [JwtVerifier, SID_REVOCATION],
      useFactory: (verifier: JwtVerifier, revocation: SidRevocationStore) =>
        new AuthGuard(verifier, revocation),
    },
    RateLimitGuard,
  ],
})
export class AppModule {}
