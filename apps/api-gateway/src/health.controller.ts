import { Controller, Get } from '@nestjs/common';
import { HealthService } from '@social/platform-telemetry';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  ready() {
    // Gateway is ready if process is up; upstream probes come later.
    return this.health.ready();
  }
}
