import type { RedisClient } from '@social/platform-redis';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { TicketService } from '../ticket/ticket.service';
import { runDeliverySession } from './delivery-session';
import { parseClientFrame, type RealtimeFrame } from './protocol';

const MAX_FRAME_BYTES = 4 * 1024;
const INBOUND_RATE_PER_SEC = 10;

/**
 * Attach WebSocket upgrade handler to the Nest HTTP server.
 * Path: /v1/realtime/ws?ticket=…&since=…
 */
export function attachRealtimeWebSocket(options: {
  server: HttpServer;
  redis: RedisClient;
  tickets: TicketService;
}): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });

  options.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/v1/realtime/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void handleConnection(ws, req, options);
  });

  return wss;
}

async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  options: {
    redis: RedisClient;
    tickets: TicketService;
  },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ticket = url.searchParams.get('ticket') ?? '';
  const since = url.searchParams.get('since') ?? undefined;

  const payload = await options.tickets.consume(ticket);
  if (!payload) {
    send(ws, {
      t: 'error',
      d: { code: 'unauthorized', message: 'invalid or expired ticket' },
    });
    ws.close(4401, 'unauthorized');
    return;
  }

  const connId = randomUUID();
  const { connRef, evicted } = await options.tickets.registerConnection(
    payload.userId,
    connId,
  );

  let closed = false;
  let inboundWindow = Date.now();
  let inboundCount = 0;

  const cleanup = () => {
    closed = true;
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  ws.on('message', (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      ws.close(1009, 'binary not allowed');
      return;
    }
    const raw = data.toString();
    if (Buffer.byteLength(raw, 'utf8') > MAX_FRAME_BYTES) {
      ws.close(1009, 'frame too large');
      return;
    }
    const now = Date.now();
    if (now - inboundWindow > 1000) {
      inboundWindow = now;
      inboundCount = 0;
    }
    inboundCount += 1;
    if (inboundCount > INBOUND_RATE_PER_SEC) {
      send(ws, {
        t: 'error',
        d: { code: 'rate_limited', retry_after: 1 },
      });
      ws.close(4429, 'rate limited');
      return;
    }
    const frame = parseClientFrame(raw);
    if (!frame) return;
    if (frame.t === 'ping') {
      send(ws, { t: 'pong' });
    }
    // ack / subscribe: cursor is advanced server-side on delivery; ack is advisory
  });

  try {
    await runDeliverySession({
      redis: options.redis,
      tickets: options.tickets,
      userId: payload.userId,
      connId,
      connRef,
      ...(since !== undefined && since !== null ? { since } : {}),
      send: (frame) => send(ws, frame),
      isClosed: () => closed || ws.readyState !== ws.OPEN,
      evicted: evicted.length > 0,
    });
  } finally {
    closed = true;
    if (ws.readyState === ws.OPEN) {
      ws.close(1000, 'session end');
    }
  }
}

function send(ws: WebSocket, frame: RealtimeFrame): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(frame));
}
