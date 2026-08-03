import { Controller, Get } from '@nestjs/common';

@Controller()
export class VersionController {
  @Get('v1/version')
  version() {
    return {
      service: process.env.SERVICE_NAME ?? 'api-gateway',
      version: process.env.APP_VERSION ?? '0.0.0-dev',
      commit: process.env.GIT_COMMIT ?? null,
      node: process.version,
      env: process.env.NODE_ENV ?? 'development',
    };
  }
}
