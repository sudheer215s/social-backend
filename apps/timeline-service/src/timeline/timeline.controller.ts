import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { encodeCursor } from '@social/platform-db';
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
    @Query('cursor') cursor?: string,
    /** @deprecated prefer opaque `cursor` */
    @Query('before') before?: string,
  ) {
    const pageLimit = limit ? Number(limit) : 20;
    const beforeId = resolveBeforeCursor(cursor, before);
    const page = await this.timelines.getHomeTimeline(
      req.userId!,
      pageLimit,
      beforeId,
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
    const lastId = postIds[postIds.length - 1] ?? null;
    const hasMore = posts.length >= pageLimit;
    return {
      posts,
      postIds,
      rebuilt: page.rebuilt,
      filtered,
      // Backward-compatible raw post id
      nextCursor: lastId,
      page: {
        next_cursor: hasMore && lastId ? encodeCursor({ id: lastId }) : null,
        has_more: hasMore,
      },
    };
  }
}

function resolveBeforeCursor(
  cursor?: string,
  before?: string,
): string | undefined {
  const raw = cursor ?? before;
  if (!raw) return undefined;
  // Opaque base64url cursor
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { id?: string };
    if (typeof parsed.id === 'string' && isUuid(parsed.id)) {
      return parsed.id;
    }
  } catch {
    // fall through — may be raw UUIDv7
  }
  if (isUuid(raw)) return raw;
  throw new BadRequestException('Invalid cursor');
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}
