import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';
import { AuthGuard } from './auth.guard';
import { IdentityProxy } from '../proxy/identity.proxy';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

@Controller()
export class AuthController {
  constructor(private readonly identity: IdentityProxy) {}

  private async forward(
    method: string,
    path: string,
    options?: { body?: unknown; authorization?: string },
  ): Promise<unknown> {
    const { status, json } = await this.identity.forward(method, path, options);
    if (status >= 400) {
      throw new HttpException(
        (json as object) ?? { message: 'Upstream error' },
        status,
      );
    }
    return json;
  }

  private bearer(req: AuthedRequest): string | undefined {
    const h = req.headers.authorization;
    return typeof h === 'string' ? h : undefined;
  }

  @Post('v1/auth/register')
  @UseGuards(RateLimitGuard)
  register(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/register', { body });
  }

  @Post('v1/auth/login')
  @UseGuards(RateLimitGuard)
  login(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/login', { body });
  }

  @Post('v1/auth/refresh')
  @UseGuards(RateLimitGuard)
  refresh(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/refresh', { body });
  }

  @Post('v1/auth/logout')
  logout(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/logout', { body });
  }

  @Post('v1/auth/verify-email')
  verifyEmail(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/verify-email', { body });
  }

  @Post('v1/auth/password/forgot')
  @UseGuards(RateLimitGuard)
  forgotPassword(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/password/forgot', { body });
  }

  @Post('v1/auth/password/reset')
  @UseGuards(RateLimitGuard)
  resetPassword(@Body() body: unknown) {
    return this.forward('POST', '/v1/auth/password/reset', { body });
  }

  @Get('v1/auth/jwks')
  jwks() {
    return this.forward('GET', '/v1/auth/jwks');
  }

  @Get('.well-known/jwks.json')
  wellKnownJwks() {
    return this.forward('GET', '/.well-known/jwks.json');
  }

  @Get('v1/users/me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    const authorization = this.bearer(req);
    return this.forward(
      'GET',
      '/v1/users/me',
      authorization ? { authorization } : {},
    );
  }

  @Patch('v1/users/me')
  @UseGuards(AuthGuard)
  updateMe(@Req() req: AuthedRequest, @Body() body: unknown) {
    const authorization = this.bearer(req);
    return this.forward('PATCH', '/v1/users/me', {
      body,
      ...(authorization ? { authorization } : {}),
    });
  }

  @Get('v1/users/by-username/:username')
  byUsername(@Param('username') username: string) {
    return this.forward(
      'GET',
      `/v1/users/by-username/${encodeURIComponent(username)}`,
    );
  }

  @Get('v1/me')
  @UseGuards(AuthGuard)
  claims(@Req() req: AuthedRequest) {
    return {
      userId: req.user?.userId,
      sessionId: req.user?.sessionId,
      scope: req.user?.scope ?? [],
    };
  }
}
