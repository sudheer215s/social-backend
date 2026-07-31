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
}
