import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt.guard';
import { GraphService } from './graph.service';

@Controller('v1/graph')
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Post('follows/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async follow(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.follow(req.userId!, userId);
  }

  @Delete('follows/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async unfollow(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.unfollow(req.userId!, userId);
  }

  @Get('following/:userId')
  async following(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.graph.listFollowing(
      userId,
      limit ? Number(limit) : 50,
    );
    return { items };
  }

  @Get('followers/:userId')
  async followers(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.graph.listFollowers(
      userId,
      limit ? Number(limit) : 50,
    );
    return { items };
  }

  /** Internal fan-out helper (ids only). */
  @Get('followers/:userId/ids')
  async followerIds(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const ids = await this.graph.listFollowerIds(
      userId,
      limit ? Number(limit) : 1000,
    );
    return { ids };
  }

  @Get('followers/:userId/count')
  async followerCount(@Param('userId') userId: string) {
    return { count: await this.graph.followerCount(userId) };
  }

  /**
   * Users blocked by or blocking viewer (for hydration fail-closed filter).
   */
  @Get('blocks/:userId/related-ids')
  @UseGuards(JwtAuthGuard)
  async blockedRelated(
    @Req() req: AuthedRequest,
    @Param('userId') userId: string,
  ) {
    // Only the subject (or future admin) may read their block set
    if (req.userId !== userId) {
      return { ids: [] as string[] };
    }
    const ids = await this.graph.listBlockedRelatedIds(userId);
    return { ids };
  }

  /** Internal hydrate helper (timeline-service). No JWT — network-private. */
  @Get('blocks/:userId/related-ids/internal')
  async blockedRelatedInternal(@Param('userId') userId: string) {
    const ids = await this.graph.listBlockedRelatedIds(userId);
    return { ids };
  }

  @Post('blocks/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async block(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.block(req.userId!, userId);
  }

  @Delete('blocks/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async unblock(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.unblock(req.userId!, userId);
  }

  @Post('mutes/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async mute(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.mute(req.userId!, userId);
  }

  @Delete('mutes/:userId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async unmute(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    await this.graph.unmute(req.userId!, userId);
  }

  /** Internal hydrate helper: muted author ids for viewer. */
  @Get('mutes/:userId/ids/internal')
  async mutedIdsInternal(@Param('userId') userId: string) {
    return { ids: await this.graph.listMutedIds(userId) };
  }

  /**
   * Notification suppress check: block either way or mute.
   * Query: viewerId, actorId
   */
  @Get('relationship/suppress-notification')
  async suppressNotification(
    @Query('viewerId') viewerId: string,
    @Query('actorId') actorId: string,
  ) {
    if (!viewerId || !actorId) {
      return { suppress: false };
    }
    const suppress = await this.graph.shouldSuppressNotification(
      viewerId,
      actorId,
    );
    return { suppress };
  }
}
