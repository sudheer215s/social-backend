/**
 * Thin HTTP forwarder to identity-service until gRPC is wired (Phase 1).
 */
export class IdentityProxy {
  constructor(private readonly baseUrl: string) {}

  async forward(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const init: RequestInit = {
      method,
      headers:
        body !== undefined
          ? { 'content-type': 'application/json', accept: 'application/json' }
          : { accept: 'application/json' },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
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
