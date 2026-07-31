import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { loginSchema, refreshSchema, registerSchema } from './validation';
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

  /** Public JWKS for access-token verification (gateway / resource servers). */
  @Get('.well-known/jwks.json')
  jwks() {
    return this.keys.toJwks();
  }

  @Get('v1/auth/jwks')
  jwksAlias() {
    return this.keys.toJwks();
  }
}
