import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from '@social/platform-telemetry';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process liveness only — never depends on external systems. */
  @Get('live')
  live() {
    return this.health.live();
  }

  /** Dependency readiness — may return 503 when unavailable. */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.ready();
    if (result.status === 'unavailable') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
