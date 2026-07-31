import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';
import { AuthGuard } from './auth.guard';
import { IdentityProxy } from '../proxy/identity.proxy';

@Controller()
export class AuthController {
  constructor(private readonly identity: IdentityProxy) {}

  private async forward(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const { status, json } = await this.identity.forward(method, path, body);
    if (status >= 400) {
      throw new HttpException(
        (json as object) ?? { message: 'Upstream error' },
        status,
      );
    }
    return json;
  }

  @Post('v1/auth/register')
  register(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/register', body);
  }

  @Post('v1/auth/login')
  login(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/login', body);
  }

  @Post('v1/auth/refresh')
  refresh(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/refresh', body);
  }

  @Post('v1/auth/logout')
  logout(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/logout', body);
  }

  @Post('v1/auth/verify-email')
  verifyEmail(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/verify-email', body);
  }

  @Post('v1/auth/password/forgot')
  forgotPassword(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/password/forgot', body);
  }

  @Post('v1/auth/password/reset')
  resetPassword(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/password/reset', body);
  }

  @Get('v1/auth/jwks')
  jwks() {
    return this.forward('GET', '/v1/auth/jwks');
  }

  @Get('.well-known/jwks.json')
  wellKnownJwks() {
    return this.forward('GET', '/.well-known/jwks.json');
  }

  /** Authenticated whoami — proves gateway JWT verification. */
  @Get('v1/me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return {
      userId: req.user?.userId,
      sessionId: req.user?.sessionId,
      scope: req.user?.scope ?? [],
    };
  }
}
