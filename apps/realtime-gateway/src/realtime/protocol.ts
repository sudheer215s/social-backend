export type RealtimeFrame =
  | { t: 'ready'; d: { since: string; connId: string } }
  | {
      t: 'notification';
      d: {
        id: string;
        type: string;
        streamId: string;
        ts: string;
        item?: unknown;
      };
    }
  | { t: 'unread'; d: { count: number } }
  | { t: 'pong' }
  | { t: 'ping' }
  | { t: 'error'; d: { code: string; message?: string; retry_after?: number } };

export type ClientFrame =
  | { t: 'ping' }
  | { t: 'ack'; d: { id: string } }
  | { t: 'subscribe'; d?: { since?: string } };

export function parseClientFrame(raw: string): ClientFrame | null {
  try {
    const v = JSON.parse(raw) as ClientFrame;
    if (!v || typeof v !== 'object' || typeof v.t !== 'string') return null;
    return v;
  } catch {
    return null;
  }
}
