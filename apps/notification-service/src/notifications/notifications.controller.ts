import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
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

  /**
   * Batch hydrate by id. Auth: service token + x-user-id (realtime-gateway).
   * Dev: x-user-id alone when REALTIME_SERVICE_TOKEN is unset.
   */
  @Get('batch')
  async batch(@Req() req: Request, @Query('ids') ids?: string) {
    const userId = resolveBatchUserId(req);
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const items = await this.notifications.getByIds(userId, list);
    return { items };
  }

  @Post('read')
  @UseGuards(JwtAuthGuard)
  async markRead(@Req() req: AuthedRequest, @Body() body: { ids?: string[] }) {
    const updated = await this.notifications.markRead(req.userId!, body?.ids);
    return { updated };
  }
}

function resolveBatchUserId(req: Request): string {
  const expected = process.env.REALTIME_SERVICE_TOKEN;
  const serviceToken = req.headers['x-service-token'];
  const headerUser = req.headers['x-user-id'];
  if (
    expected &&
    typeof serviceToken === 'string' &&
    serviceToken === expected &&
    typeof headerUser === 'string' &&
    headerUser.length > 0
  ) {
    return headerUser;
  }
  if (!expected && typeof headerUser === 'string' && headerUser.length > 0) {
    return headerUser;
  }
  throw new UnauthorizedException('batch requires x-service-token + x-user-id');
}
