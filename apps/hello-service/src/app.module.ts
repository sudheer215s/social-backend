import { Module } from '@nestjs/common';
import { HealthService } from '@social/platform-telemetry';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: HealthService,
      useFactory: () =>
        // Phase 0: no external deps yet. Probes land with Postgres/Redis wiring.
        new HealthService({ probes: [] }),
    },
  ],
})
export class AppModule {}
