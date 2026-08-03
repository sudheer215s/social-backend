import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthedRequest } from './auth.guard';
import { AuthGuard } from './auth.guard';
import { IdentityGrpcClient } from '../proxy/identity.grpc.client';
import { IdentityProxy } from '../proxy/identity.proxy';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import {
  clearRefreshCookie,
  extractRefreshTokenFromBody,
  getRefreshCookie,
  setRefreshCookie,
  tokensFromJson,
} from './refresh-cookie';

@Controller()
export class AuthController {
  constructor(
    private readonly identity: IdentityProxy,
    private readonly identityGrpc: IdentityGrpcClient,
  ) {}

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

  private maybeSetRefreshCookie(res: Response, json: unknown): void {
    const tokens = tokensFromJson(json);
    if (tokens?.refreshToken) {
      setRefreshCookie(res, tokens.refreshToken);
    }
  }

  @Post('v1/auth/register')
  @UseGuards(RateLimitGuard)
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const json = await this.forward('POST', '/v1/auth/register', { body });
    this.maybeSetRefreshCookie(res, json);
    return json;
  }

  @Post('v1/auth/login')
  @UseGuards(RateLimitGuard)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const json = await this.forward('POST', '/v1/auth/login', { body });
    this.maybeSetRefreshCookie(res, json);
    return json;
  }

  @Post('v1/auth/refresh')
  @UseGuards(RateLimitGuard)
  async refresh(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fromBody = extractRefreshTokenFromBody(body);
    const fromCookie = getRefreshCookie(req);
    const refreshToken = fromBody ?? fromCookie;
    if (!refreshToken) {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'refreshToken required in body or rt cookie',
        },
        400,
      );
    }
    const json = await this.forward('POST', '/v1/auth/refresh', {
      body: { refreshToken },
    });
    this.maybeSetRefreshCookie(res, json);
    return json;
  }

  @Post('v1/auth/logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const fromBody = extractRefreshTokenFromBody(body);
    const fromCookie = getRefreshCookie(req);
    const refreshToken = fromBody ?? fromCookie;
    if (refreshToken) {
      try {
        await this.forward('POST', '/v1/auth/logout', {
          body: { refreshToken },
        });
      } catch {
        // Still clear cookie even if token already invalid
      }
    }
    clearRefreshCookie(res);
  }

  @Post('v1/auth/logout-all')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logoutAll(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const authorization = this.bearer(req);
    await this.forward(
      'POST',
      '/v1/auth/logout-all',
      authorization ? { authorization } : {},
    );
    clearRefreshCookie(res);
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
  async me(@Req() req: AuthedRequest) {
    if (process.env.IDENTITY_USE_GRPC === '1' && req.user?.userId) {
      try {
        const u = await this.identityGrpc.getUser(req.user.userId);
        return {
          user: {
            id: u.id,
            username: u.username,
            email: u.email,
            emailVerified: u.email_verified,
            displayName: u.display_name || null,
            bio: u.bio || null,
            avatarMediaId: u.avatar_media_id || null,
            visibility: u.visibility,
            status: u.status,
            isVerified: u.is_verified,
            followerCount: Number(u.follower_count),
            followingCount: Number(u.following_count),
            postCount: Number(u.post_count),
          },
        };
      } catch {
        // fall through to HTTP proxy
      }
    }
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

  @Delete('v1/users/me')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  deactivate(@Req() req: AuthedRequest) {
    const authorization = this.bearer(req);
    return this.forward(
      'DELETE',
      '/v1/users/me',
      authorization ? { authorization } : {},
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
