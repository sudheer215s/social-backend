import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  hashIdempotencyParts,
  hashRequestBody,
  type IdempotencyStore,
} from '@social/platform-redis';
import { outboundRequestHeaders } from '@social/platform-telemetry';
import type { AuthedRequest } from '../auth/auth.guard';
import { AuthGuard } from '../auth/auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { TicketRateLimitGuard } from '../rate-limit/ticket-rate-limit.guard';
import { IDEMPOTENCY_STORE } from '../tokens';
import { fetchUpstream } from '../proxy/upstream';

/**
 * HTTP proxy to post-service and graph-service until BFF composition lands.
 */
@Controller()
export class ContentController {
  constructor(
    @Optional()
    @Inject(IDEMPOTENCY_STORE)
    private readonly idempotency: IdempotencyStore | null = null,
  ) {}

  private async forward(
    baseEnv: string,
    fallback: string,
    method: string,
    path: string,
    options?: { body?: unknown; authorization?: string },
  ): Promise<unknown> {
    const base = process.env[baseEnv] ?? fallback;
    const headers = outboundRequestHeaders({ accept: 'application/json' });
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
    const res = await fetchUpstream(`${base}${path}`, init);
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

  /**
   * Create post. Requires `Idempotency-Key` (design §5) so retries do not
   * double-publish. Replays return the stored body with `Idempotent-Replay: true`.
   */
  @Post('v1/posts')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
  async createPost(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const authorization = this.bearer(req);
    const userId = req.user?.userId;
    if (!userId) {
      throw new HttpException({ message: 'Unauthorized' }, 401);
    }

    const rawKey = req.headers['idempotency-key'];
    const idemKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    const requireKey = process.env.IDEMPOTENCY_OPTIONAL !== '1';
    if (requireKey && (!idemKey || idemKey.length > 128)) {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'Idempotency-Key header required (1–128 chars)',
        },
        400,
      );
    }

    if (!this.idempotency || !idemKey) {
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

    const storeKey = hashIdempotencyParts(userId, 'POST', '/v1/posts', idemKey);
    const requestHash = hashRequestBody(body);
    const begin = await this.idempotency.begin(storeKey, requestHash);

    if (begin.outcome === 'conflict') {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'Idempotency-Key reused with a different request body',
        },
        422,
      );
    }
    if (begin.outcome === 'in_flight') {
      res.setHeader('Retry-After', '1');
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'Request with this Idempotency-Key is already in flight',
        },
        409,
      );
    }
    if (begin.outcome === 'replay') {
      res.setHeader('Idempotent-Replay', 'true');
      if (begin.status >= 400) {
        throw new HttpException(
          (begin.body as object) ?? { message: 'Upstream error' },
          begin.status,
        );
      }
      res.status(begin.status);
      return begin.body;
    }

    try {
      const json = await this.forward(
        'POST_BASE_URL',
        'http://127.0.0.1:3002',
        'POST',
        '/v1/posts',
        {
          body,
          ...(authorization ? { authorization } : {}),
        },
      );
      await this.idempotency.complete(storeKey, requestHash, 201, json);
      res.status(201);
      return json;
    } catch (err) {
      if (err instanceof HttpException) {
        const status = err.getStatus();
        if (status < 500) {
          await this.idempotency.complete(
            storeKey,
            requestHash,
            status,
            err.getResponse(),
          );
        } else {
          await this.idempotency.abandon(storeKey);
        }
      } else {
        await this.idempotency.abandon(storeKey);
      }
      throw err;
    }
  }

  @Get('v1/posts')
  listPosts(
    @Req() req: AuthedRequest,
    @Query('authorId') authorId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const q = new URLSearchParams({ authorId });
    if (limit) q.set('limit', limit);
    if (cursor) q.set('cursor', cursor);
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts?${q}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/posts/:id/replies')
  listReplies(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts/${id}/replies${q}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/posts/:id/thread')
  getThread(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts/${id}/thread${q}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/posts/:id')
  getPost(@Req() req: AuthedRequest, @Param('id') id: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'POST_BASE_URL',
      'http://127.0.0.1:3002',
      'GET',
      `/v1/posts/${id}`,
      authorization ? { authorization } : {},
    );
  }

  @Delete('v1/posts/:id')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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

  @Get('v1/graph/follow-requests/incoming')
  @UseGuards(AuthGuard)
  incomingFollowRequests(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
  ) {
    const authorization = this.bearer(req);
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'GET',
      `/v1/graph/follow-requests/incoming${q}`,
      authorization ? { authorization } : {},
    );
  }

  @Post('v1/graph/follow-requests/:requesterId/accept')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
  acceptFollowRequest(
    @Req() req: AuthedRequest,
    @Param('requesterId') requesterId: string,
  ) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'POST',
      `/v1/graph/follow-requests/${requesterId}/accept`,
      authorization ? { authorization } : {},
    );
  }

  @Post('v1/graph/follow-requests/:requesterId/reject')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
  @HttpCode(204)
  rejectFollowRequest(
    @Req() req: AuthedRequest,
    @Param('requesterId') requesterId: string,
  ) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'POST',
      `/v1/graph/follow-requests/${requesterId}/reject`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/graph/following/:userId')
  following(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString() ? `?${q}` : '';
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'GET',
      `/v1/graph/following/${userId}${qs}`,
    );
  }

  @Get('v1/graph/followers/:userId')
  followers(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString() ? `?${q}` : '';
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'GET',
      `/v1/graph/followers/${userId}${qs}`,
    );
  }

  @Post('v1/graph/blocks/:userId')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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
  @UseGuards(AuthGuard, EmailVerifiedGuard)
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

  @Post('v1/graph/mutes/:userId')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
  @HttpCode(204)
  mute(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'POST',
      `/v1/graph/mutes/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Delete('v1/graph/mutes/:userId')
  @UseGuards(AuthGuard, EmailVerifiedGuard)
  @HttpCode(204)
  unmute(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    const authorization = this.bearer(req);
    return this.forward(
      'GRAPH_BASE_URL',
      'http://127.0.0.1:3003',
      'DELETE',
      `/v1/graph/mutes/${userId}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/timelines/home')
  @UseGuards(AuthGuard)
  home(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('before') before?: string,
  ) {
    const authorization = this.bearer(req);
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (cursor) q.set('cursor', cursor);
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

  @Get('v1/notifications')
  @UseGuards(AuthGuard)
  listNotifications(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const authorization = this.bearer(req);
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString() ? `?${q}` : '';
    return this.forward(
      'NOTIFICATION_BASE_URL',
      'http://127.0.0.1:3005',
      'GET',
      `/v1/notifications${qs}`,
      authorization ? { authorization } : {},
    );
  }

  @Get('v1/notifications/unread-count')
  @UseGuards(AuthGuard)
  unreadCount(@Req() req: AuthedRequest) {
    const authorization = this.bearer(req);
    return this.forward(
      'NOTIFICATION_BASE_URL',
      'http://127.0.0.1:3005',
      'GET',
      '/v1/notifications/unread-count',
      authorization ? { authorization } : {},
    );
  }

  @Post('v1/notifications/read')
  @UseGuards(AuthGuard)
  markNotificationsRead(@Req() req: AuthedRequest, @Body() body: unknown) {
    const authorization = this.bearer(req);
    return this.forward(
      'NOTIFICATION_BASE_URL',
      'http://127.0.0.1:3005',
      'POST',
      '/v1/notifications/read',
      {
        body,
        ...(authorization ? { authorization } : {}),
      },
    );
  }

  @Get('v1/search')
  search(
    @Query('q') q: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (limit) params.set('limit', limit);
    const qs = params.toString() ? `?${params}` : '';
    return this.forward(
      'SEARCH_BASE_URL',
      'http://127.0.0.1:3006',
      'GET',
      `/v1/search${qs}`,
    );
  }

  /** Short-lived ticket for SSE on realtime-gateway (not JWT-in-query). */
  @Post('v1/realtime/ticket')
  @UseGuards(AuthGuard, TicketRateLimitGuard)
  realtimeTicket(@Req() req: AuthedRequest) {
    const authorization = this.bearer(req);
    return this.forward(
      'REALTIME_BASE_URL',
      'http://127.0.0.1:3007',
      'POST',
      '/v1/realtime/ticket',
      authorization ? { authorization } : {},
    );
  }
}
