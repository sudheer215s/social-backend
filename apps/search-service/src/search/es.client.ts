/**
 * Minimal Elasticsearch HTTP client (no heavy SDK dependency).
 * Search failures are never fatal for the product — callers degrade to empty.
 */

export class EsClient {
  constructor(private readonly baseUrl: string) {}

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, {
        headers: { accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureIndex(
    name: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const exists = await fetch(`${this.baseUrl}/${encodeURIComponent(name)}`, {
      method: 'HEAD',
    });
    if (exists.ok) return;
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 400) {
      const text = await res.text();
      throw new Error(`ensureIndex ${name}: ${res.status} ${text}`);
    }
  }

  async indexDoc(
    index: string,
    id: string,
    doc: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}?refresh=false`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(doc),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`indexDoc ${index}/${id}: ${res.status} ${text}`);
    }
  }

  async deleteDoc(index: string, id: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    // 404 = already gone
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`deleteDoc ${index}/${id}: ${res.status} ${text}`);
    }
  }

  async search(
    index: string,
    body: Record<string, unknown>,
  ): Promise<EsSearchResponse> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(index)}/_search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`search ${index}: ${res.status} ${text}`);
    }
    return (await res.json()) as EsSearchResponse;
  }
}

export interface EsHit {
  _id: string;
  _score: number | null;
  _source: Record<string, unknown>;
}

export interface EsSearchResponse {
  hits: {
    total?: { value: number } | number;
    hits: EsHit[];
  };
}
