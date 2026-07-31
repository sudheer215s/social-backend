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
    const pageLimit = limit ? Number(limit) : 20;
    const page = await this.timelines.getHomeTimeline(
      req.userId!,
      pageLimit,
      before,
    );
    const { posts, filtered } = await this.timelines.hydratePosts(
      req.userId!,
      page.postIds,
      pageLimit,
    );
    const postIds = posts
      .map((p) =>
        p && typeof p === 'object' && 'id' in p
          ? String((p as { id: string }).id)
          : '',
      )
      .filter(Boolean);
    return {
      posts,
      postIds,
      rebuilt: page.rebuilt,
      filtered,
      nextCursor: postIds[postIds.length - 1] ?? null,
    };
  }
}
