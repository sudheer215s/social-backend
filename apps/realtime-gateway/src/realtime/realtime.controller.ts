import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RedisClient } from '@social/platform-redis';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt.guard';
import { REDIS } from '../tokens';
import { TicketService } from '../ticket/ticket.service';
import { runDeliverySession } from './delivery-session';
import type { RealtimeFrame } from './protocol';

/**
 * Ticket issue + SSE delivery.
 * WebSocket: GET upgrade /v1/realtime/ws?ticket=… (see ws.gateway.ts)
 */
@Controller('v1/realtime')
export class RealtimeController {
  constructor(
    private readonly tickets: TicketService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  @Post('ticket')
  @UseGuards(JwtAuthGuard)
  async issueTicket(@Req() req: AuthedRequest) {
    const result = await this.tickets.issue(req.userId!, req.sessionId ?? null);
    return {
      ticket: result.ticket,
      expiresIn: result.expiresIn,
      streamUrl: '/v1/realtime/stream',
      wsUrl: '/v1/realtime/ws',
    };
  }

  @Get('stream')
  async stream(
    @Query('ticket') ticket: string | undefined,
    @Query('since') since: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!ticket) {
      throw new UnauthorizedException('ticket required');
    }
    const payload = await this.tickets.consume(ticket);
    if (!payload) {
      throw new UnauthorizedException('invalid or expired ticket');
    }

    const connId = randomUUID();
    const { connRef, evicted } = await this.tickets.registerConnection(
      payload.userId,
      connId,
    );

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let closed = false;
    const write = (frame: RealtimeFrame) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    res.on('close', () => {
      closed = true;
    });

    try {
      await runDeliverySession({
        redis: this.redis,
        tickets: this.tickets,
        userId: payload.userId,
        connId,
        connRef,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(since !== undefined ? { since } : {}),
        send: write,
        isClosed: () => closed,
        onSessionEnd: () => {
          closed = true;
        },
        evicted: evicted.length > 0,
      });
    } finally {
      closed = true;
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  }
}
