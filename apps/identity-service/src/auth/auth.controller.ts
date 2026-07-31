import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { loginSchema, registerSchema } from './validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema))
    body: ReturnType<typeof registerSchema.parse>,
  ) {
    const user = await this.auth.register(body);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: ReturnType<typeof loginSchema.parse>,
  ) {
    const user = await this.auth.login(body);
    return { user };
  }
}
