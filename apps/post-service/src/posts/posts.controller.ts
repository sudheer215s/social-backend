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
  async batch(@Query('ids') ids?: string) {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const posts = await this.posts.getByIds(list);
    return { posts };
  }

  @Get(':id/replies')
  async replies(@Param('id') id: string, @Query('limit') limit?: string) {
    const posts = await this.posts.listReplies(id, limit ? Number(limit) : 50);
    return { posts };
  }

  @Get(':id/thread')
  async thread(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.posts.getThread(id, limit ? Number(limit) : 50);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const post = await this.posts.getById(id);
    return { post };
  }

  @Get()
  async listByAuthor(
    @Query('authorId') authorId: string,
    @Query('limit') limit?: string,
  ) {
    const posts = await this.posts.listByAuthor(
      authorId,
      limit ? Number(limit) : 20,
    );
    return { posts };
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
