import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import { HealthService } from '@social/platform-telemetry';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';

export const PG_POOL = Symbol('PG_POOL');

type AppPool = ReturnType<typeof createPool>;

function createOptionalPool(): AppPool | null {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  const rawMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
  const max = Number.isFinite(rawMax)
    ? Math.min(Math.max(Math.floor(rawMax), 1), 10)
    : 5;
  return createPool({ connectionString: url, max });
}

function buildHealthService(pool: AppPool | null): HealthService {
  if (!pool) {
    // Unit/e2e without DATABASE_URL stay process-only ready.
    return new HealthService({ probes: [] });
  }
  return new HealthService({
    probes: [
      {
        name: 'postgres',
        check: () => checkDatabase(pool),
      },
    ],
  });
}

@Module({
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: PG_POOL,
      useFactory: createOptionalPool,
    },
    {
      provide: HealthService,
      inject: [PG_POOL],
      useFactory: buildHealthService,
    },
  ],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: AppPool | null) {}

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
