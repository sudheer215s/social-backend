import {
  Body,
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
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { ZodValidationPipe } from '../common/zod.pipe';
import { createPostSchema, type CreatePostInput } from './posts.validation';
import { PostsService } from './posts.service';

@Controller('v1/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(createPostSchema)) body: CreatePostInput,
  ) {
    const post = await this.posts.create(req.userId!, body);
    return { post };
  }

  @Get('batch')
  @UseGuards(OptionalJwtAuthGuard)
  async batch(
    @Req() req: AuthedRequest,
    @Query('ids') ids?: string,
    @Query('viewerId') viewerIdQuery?: string,
  ) {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    // Prefer authenticated viewer; allow internal hydrate with viewerId query
    // (timeline-service) when no JWT is present.
    const viewerId = req.userId ?? viewerIdQuery;
    const posts = await this.posts.getByIds(list, viewerId);
    return { posts };
  }

  @Get('viewer-states')
  @UseGuards(JwtAuthGuard)
  async viewerStates(@Req() req: AuthedRequest, @Query('ids') ids?: string) {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const states = await this.posts.getViewerStates(req.userId!, list);
    return { states };
  }

  /**
   * Internal/timeline: recent top-level post IDs for many authors (bounded).
   * Query: authorIds=uuid,uuid&perAuthor=20&limit=400&before=&since=
   */
  @Get('recent-ids')
  async recentIds(
    @Query('authorIds') authorIds?: string,
    @Query('perAuthor') perAuthor?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('since') since?: string,
  ) {
    const ids = (authorIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const postIds = await this.posts.recentIdsByAuthors({
      authorIds: ids,
      ...(perAuthor ? { perAuthor: Number(perAuthor) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(before ? { beforeId: before } : {}),
      ...(since ? { sinceId: since } : {}),
    });
    return { ids: postIds };
  }

  @Get(':id/replies')
  @UseGuards(OptionalJwtAuthGuard)
  async replies(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const posts = await this.posts.listReplies(
      id,
      limit ? Number(limit) : 50,
      req.userId,
    );
    return { posts };
  }

  @Get(':id/thread')
  @UseGuards(OptionalJwtAuthGuard)
  async thread(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.posts.getThread(id, limit ? Number(limit) : 50, req.userId);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    const post = await this.posts.getById(id, req.userId);
    return { post };
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async listByAuthor(
    @Req() req: AuthedRequest,
    @Query('authorId') authorId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.posts.listByAuthor(
      authorId,
      limit ? Number(limit) : 20,
      req.userId,
      cursor,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.softDelete(id, req.userId!);
  }

  @Post(':id/likes')
  @UseGuards(JwtAuthGuard)
  async like(@Req() req: AuthedRequest, @Param('id') id: string) {
    const post = await this.posts.like(id, req.userId!);
    return { post };
  }

  @Delete(':id/likes')
  @UseGuards(JwtAuthGuard)
  async unlike(@Req() req: AuthedRequest, @Param('id') id: string) {
    const post = await this.posts.unlike(id, req.userId!);
    return { post };
  }
}
