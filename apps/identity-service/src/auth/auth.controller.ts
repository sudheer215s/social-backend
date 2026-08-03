import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard, type IdentityAuthedRequest } from './jwt-auth.guard';
import { JwtKeyRing } from '../tokens/jwt-keys';

const RT_COOKIE = 'rt';
const RT_MAX_AGE = 30 * 24 * 60 * 60;

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly keys: JwtKeyRing,
  ) {}

  @Post('v1/auth/register')
  async register(
    @Body(new ZodValidationPipe(registerSchema))
    body: ReturnType<typeof registerSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(body);
    this.setRtCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Post('v1/auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: ReturnType<typeof loginSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body);
    this.setRtCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Post('v1/auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body(new ZodValidationPipe(refreshSchema))
    body: ReturnType<typeof refreshSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken ?? this.readRtCookie(req);
    if (!token) {
      throw new BadRequestException(
        'refreshToken required in body or rt cookie',
      );
    }
    const tokens = await this.auth.refresh(token);
    this.setRtCookie(res, tokens.refreshToken);
    return { tokens };
  }

  @Post('v1/auth/logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const parsed = refreshSchema.safeParse(body ?? {});
    const fromBody = parsed.success ? parsed.data.refreshToken : undefined;
    const token = fromBody ?? this.readRtCookie(req);
    if (token) {
      await this.auth.logout(token);
    }
    this.clearRtCookie(res);
  }

  @Post('v1/auth/logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logoutAll(
    @Req() req: IdentityAuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(req.userId!);
    this.clearRtCookie(res);
  }

  @Post('v1/auth/verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema))
    body: ReturnType<typeof verifyEmailSchema.parse>,
  ) {
    return this.auth.verifyEmail(body);
  }

  @Post('v1/auth/password/forgot')
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema))
    body: ReturnType<typeof forgotPasswordSchema.parse>,
  ) {
    return this.auth.forgotPassword(body);
  }

  @Post('v1/auth/password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: ReturnType<typeof resetPasswordSchema.parse>,
  ) {
    return this.auth.resetPassword(body);
  }

  @Get('.well-known/jwks.json')
  jwks() {
    return this.keys.toJwks();
  }

  @Get('v1/auth/jwks')
  jwksAlias() {
    return this.keys.toJwks();
  }

  private readRtCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (typeof header !== 'string') return undefined;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const k = part.slice(0, idx).trim();
      if (k !== RT_COOKIE) continue;
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      return v.length >= 20 ? v : undefined;
    }
    return undefined;
  }

  private setRtCookie(res: Response, refreshToken: string): void {
    const secure =
      process.env.COOKIE_SECURE === '1' ||
      process.env.NODE_ENV === 'production';
    const parts = [
      `${RT_COOKIE}=${encodeURIComponent(refreshToken)}`,
      'HttpOnly',
      'Path=/v1/auth',
      'SameSite=Strict',
      `Max-Age=${RT_MAX_AGE}`,
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  private clearRtCookie(res: Response): void {
    const secure =
      process.env.COOKIE_SECURE === '1' ||
      process.env.NODE_ENV === 'production';
    const parts = [
      `${RT_COOKIE}=`,
      'HttpOnly',
      'Path=/v1/auth',
      'SameSite=Strict',
      'Max-Age=0',
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
}
