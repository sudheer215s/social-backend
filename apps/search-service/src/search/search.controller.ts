import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SearchService } from './search.service';

const indexUserSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(1).max(64),
  displayName: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
  followerCount: z.number().int().nonnegative().optional(),
  isVerified: z.boolean().optional(),
  visibility: z.string().optional(),
  status: z.string().optional(),
  discoverable: z.boolean().optional(),
  createdAt: z.string().optional(),
});

const indexPostSchema = z.object({
  postId: z.string().uuid(),
  authorId: z.string().uuid(),
  content: z.string().max(5000),
  createdAt: z.string().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  replyCount: z.number().int().nonnegative().optional(),
});

/**
 * Query + internal index bootstrap / reindex endpoints.
 * Live path: Kafka user.created/updated from identity outbox.
 */
@Controller('v1/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async query(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.search.search(
      q ?? '',
      type,
      limit ? Number(limit) : 20,
    );
    return result;
  }

  @Post('index/users')
  async indexUser(@Body() body: unknown) {
    const input = indexUserSchema.parse(body);
    await this.search.indexUser({
      userId: input.userId,
      username: input.username,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.followerCount !== undefined
        ? { followerCount: input.followerCount }
        : {}),
      ...(input.isVerified !== undefined
        ? { isVerified: input.isVerified }
        : {}),
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.discoverable !== undefined
        ? { discoverable: input.discoverable }
        : {}),
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    });
    return { ok: true };
  }

  @Post('index/posts')
  async indexPost(@Body() body: unknown) {
    const input = indexPostSchema.parse(body);
    await this.search.indexPost({
      postId: input.postId,
      authorId: input.authorId,
      content: input.content,
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
      ...(input.likeCount !== undefined ? { likeCount: input.likeCount } : {}),
      ...(input.replyCount !== undefined
        ? { replyCount: input.replyCount }
        : {}),
    });
    return { ok: true };
  }
}
