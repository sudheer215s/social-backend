import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt.guard';
import { TimelineService } from './timeline.service';

@Controller('v1/timelines')
export class TimelineController {
  constructor(private readonly timelines: TimelineService) {}

  @Get('home')
  @UseGuards(JwtAuthGuard)
  async home(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const page = await this.timelines.getHomeTimeline(
      req.userId!,
      limit ? Number(limit) : 20,
      before,
    );
    const posts = await this.timelines.hydratePosts(page.postIds);
    return {
      posts,
      postIds: page.postIds,
      rebuilt: page.rebuilt,
      nextCursor: page.postIds[page.postIds.length - 1] ?? null,
    };
  }
}
