import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt.guard';
import { NotificationsService } from './notifications.service';

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    const items = await this.notifications.listForUser(
      req.userId!,
      limit ? Number(limit) : 30,
    );
    const unreadCount = await this.notifications.unreadCount(req.userId!);
    return { items, unreadCount };
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  async unread(@Req() req: AuthedRequest) {
    return { unreadCount: await this.notifications.unreadCount(req.userId!) };
  }

  @Get('batch')
  @UseGuards(JwtAuthGuard)
  async batch(@Req() req: AuthedRequest, @Query('ids') ids?: string) {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const items = await this.notifications.getByIds(req.userId!, list);
    return { items };
  }

  @Post('read')
  @UseGuards(JwtAuthGuard)
  async markRead(@Req() req: AuthedRequest, @Body() body: { ids?: string[] }) {
    const updated = await this.notifications.markRead(req.userId!, body?.ids);
    return { updated };
  }
}
