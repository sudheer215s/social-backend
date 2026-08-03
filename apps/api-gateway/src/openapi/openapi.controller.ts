import { Controller, Get, Header } from '@nestjs/common';
import { buildGatewayOpenApi } from './openapi.builder';

@Controller()
export class OpenApiController {
  @Get('v1/openapi.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60')
  openapi(): object {
    return buildGatewayOpenApi();
  }
}
