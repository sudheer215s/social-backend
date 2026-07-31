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
import { readCatchUp, readLive } from '../stream/notification-stream';

type RealtimeFrame =
  | { t: 'ready'; d: { since: string; connId: string } }
  | {
      t: 'notification';
      d: { id: string; type: string; streamId: string; ts: string };
    }
  | { t: 'ping' }
  | { t: 'error'; d: { code: string; message?: string } };

/**
 * Ticket issue + SSE delivery.
 * Clients: POST ticket (Bearer) → GET stream?ticket=…&since=…
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
    let cursor = since && since !== '$' ? since : '$';
    const write = (frame: RealtimeFrame) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    const cleanup = async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(registryBeat);
      try {
        await this.tickets.unregisterConnection(payload.userId, connRef);
      } catch {
        // ignore
      }
      try {
        res.end();
      } catch {
        // ignore
      }
    };

    res.on('close', () => {
      void cleanup();
    });

    // Signal evicted sibling connections (best-effort local note)
    if (evicted.length > 0) {
      write({
        t: 'error',
        d: {
          code: 'connection_limit',
          message: 'oldest connection superseded',
        },
      });
    }

    // Catch-up replay when client provides a cursor
    if (since && since !== '$') {
      try {
        const missed = await readCatchUp(this.redis, payload.userId, since);
        for (const entry of missed) {
          write({
            t: 'notification',
            d: {
              id: entry.notificationId,
              type: entry.type,
              streamId: entry.streamId,
              ts: entry.ts,
            },
          });
          cursor = entry.streamId;
        }
      } catch {
        // Redis blip — still open stream for live
      }
    }

    write({
      t: 'ready',
      d: { since: cursor === '$' ? '0-0' : cursor, connId },
    });

    const heartbeat = setInterval(() => {
      write({ t: 'ping' });
    }, 25_000);

    const registryBeat = setInterval(() => {
      void this.tickets.heartbeatConnection(payload.userId);
    }, 30_000);

    // Dedicated blocking client: XREAD BLOCK holds the connection
    const blockRedis = this.redis.duplicate();
    try {
      while (!closed) {
        try {
          const entries = await readLive(
            blockRedis,
            payload.userId,
            cursor,
            5000,
            50,
          );
          for (const entry of entries) {
            write({
              t: 'notification',
              d: {
                id: entry.notificationId,
                type: entry.type,
                streamId: entry.streamId,
                ts: entry.ts,
              },
            });
            cursor = entry.streamId;
          }
        } catch (err) {
          if (closed) break;
          write({
            t: 'error',
            d: {
              code: 'stream_error',
              message: err instanceof Error ? err.message : 'read failed',
            },
          });
          await sleep(1000);
        }
      }
    } finally {
      try {
        blockRedis.disconnect();
      } catch {
        // ignore
      }
      await cleanup();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
