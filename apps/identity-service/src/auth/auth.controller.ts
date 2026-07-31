import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
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
import { JwtKeyRing } from '../tokens/jwt-keys';

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
  ) {
    return this.auth.register(body);
  }

  @Post('v1/auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: ReturnType<typeof loginSchema.parse>,
  ) {
    return this.auth.login(body);
  }

  @Post('v1/auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema))
    body: ReturnType<typeof refreshSchema.parse>,
  ) {
    const tokens = await this.auth.refresh(body.refreshToken);
    return { tokens };
  }

  @Post('v1/auth/logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema))
    body: ReturnType<typeof refreshSchema.parse>,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
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
}
