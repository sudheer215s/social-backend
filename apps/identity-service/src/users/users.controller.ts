import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  type IdentityAuthedRequest,
} from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from './profile.validation';
import { UsersService } from './users.service';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: IdentityAuthedRequest) {
    const user = await this.users.getById(req.userId!);
    return { user };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @Req() req: IdentityAuthedRequest,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    const user = await this.users.updateProfile(req.userId!, body);
    return { user };
  }

  @Get('by-username/:username')
  async byUsername(@Param('username') username: string) {
    const user = await this.users.getPublicByUsername(username);
    return { user };
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async deactivate(@Req() req: IdentityAuthedRequest): Promise<void> {
    await this.users.deactivate(req.userId!);
  }
}
