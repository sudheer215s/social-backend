import { outboundRequestHeaders } from '@social/platform-telemetry';

/**
 * Thin HTTP forwarder to identity-service until gRPC is wired (Phase 1).
 */
export class IdentityProxy {
  constructor(private readonly baseUrl: string) {}

  async forward(
    method: string,
    path: string,
    options?: { body?: unknown; authorization?: string },
  ): Promise<{ status: number; json: unknown }> {
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

    const res = await fetch(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text };
      }
    }
    return { status: res.status, json };
  }
}
