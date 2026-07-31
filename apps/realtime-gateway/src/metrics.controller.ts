import { Controller, Get, Header } from '@nestjs/common';
import { defaultRegistry } from '@social/platform-telemetry';

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return defaultRegistry.render();
  }
}
