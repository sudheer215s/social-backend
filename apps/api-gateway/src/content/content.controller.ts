import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { AuthGuard } from '../auth/auth.guard';

/**
 * HTTP proxy to post-service and graph-service until BFF composition lands.
 */
@Controller()
export class ContentController {
  private async forward(
    baseEnv: string,
    fallback: string,
    method: string,
    path: string,
    options?: { body?: unknown; authorization?: string },
  ): Promise<unknown> {
    const base = process.env[baseEnv] ?? fallback;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options?.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options?.authorization) {
      headers.authorization = options.authorization;
    }
    const init: RequestInit = { method, headers };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text };
      }
    }
    if (res.status >= 400) {
      throw new HttpException(
        (json as object) ?? { message: 'Upstream error' },
        res.status,
      );
    }
    return json;
  }

  private bearer(req: AuthedRequest): string | undefined {
    const h = req.headers.authorization;
    return typeof h === 'string' ? h : undefined;
  }

  @Post('v1/posts')
  @UseGuards(AuthGuard)
  createPost(@Req() req: AuthedRequest, @Body() body: unknown) {
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'POST',
      '/v1/posts',
      {
        body,
        ...(authorization ? { authorization } : {}),
      },
    );
  }

  @Get('v1/posts')
  listPosts(
    @Query('authorId') authorId: string,
    @Query('limit') limit?: string,
  ) {
    const q = new URLSearchParams({ authorId });
    if (limit) q.set('limit', limit);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts?${q}`,
    );
  }

  @Get('v1/posts/:id')
  getPost(@Param('id') id: string) {
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts/${id}`,
    );
  }

  @Delete('v1/posts/:id')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  deletePost(@Req() req: AuthedRequest, @Param('id') id: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'DELETE',
      `/v1/posts/${id}`,
      authorization ? { authorization } : {},
    );
  }

  @Post('v1/posts/:id/likes')
  @UseGuards(AuthGuard)
  like(@Req() req: AuthedRequest, @Param('id') id: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'POST',
      `/v1/posts/${id}/likes`,
      authorization ? { authorization } : {},
    );
  }

  @Delete('v1/posts/:id/likes')
  @UseGuards(AuthGuard)
  unlike(@Req() req: AuthedRequest, @Param('id') id: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'DELETE',
      `/v1/posts/${id}/likes`,
      authorization ? { authorization } : {},
    );
  }

  @Post('v1/graph/follows/:userId')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  follow(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'POST',
      `/v1/graph/follows/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Delete('v1/graph/follows/:userId')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  unfollow(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'DELETE',
      `/v1/graph/follows/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/graph/following/:userId')
  following(@Param('userId') userId: string, @Query('limit') limit?: string) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'GET',
      `/v1/graph/following/${userId}${q}`,
    );
  }

  @Get('v1/graph/followers/:userId')
  followers(@Param('userId') userId: string, @Query('limit') limit?: string) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'GET',
      `/v1/graph/followers/${userId}${q}`,
    );
  }

  @Post('v1/graph/blocks/:userId')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  block(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'POST',
      `/v1/graph/blocks/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Delete('v1/graph/blocks/:userId')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  unblock(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'DELETE',
      `/v1/graph/blocks/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/timelines/home')
  @UseGuards(AuthGuard)
  home(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const authorization = this.bearer(req);
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (before) q.set('before', before);
    const qs = q.toString() ? `?${q}` : '';
    return this.forward(
      'TIMELINE_BASE_URL',
      'http://127.0.0.1:3004',
      'GET',
      `/v1/timelines/home${qs}`,
      authorization ? { authorization } : {},
    );
  }
}
