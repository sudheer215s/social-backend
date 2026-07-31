/**
 * Minimal Prometheus text exposition without external deps.
 * Process-local gauges/counters; scrape each pod via /metrics.
 */

type Labels = Record<string, string>;

function labelsKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(',')}}`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class Gauge {
  private readonly values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(value: number, labels: Labels = {}): void {
    const key = labelsKey(labels);
    this.values.set(key, { labels, value });
  }

  inc(delta = 1, labels: Labels = {}): void {
    const key = labelsKey(labels);
    const cur = this.values.get(key);
    this.values.set(key, {
      labels,
      value: (cur?.value ?? 0) + delta,
    });
  }

  dec(delta = 1, labels: Labels = {}): void {
    this.inc(-delta, labels);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    return lines.join('\n');
  }
}

export class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(delta = 1, labels: Labels = {}): void {
    if (delta < 0) throw new Error('counter cannot decrease');
    const key = labelsKey(labels);
    const cur = this.values.get(key);
    this.values.set(key, {
      labels,
      value: (cur?.value ?? 0) + delta,
    });
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly gauges: Gauge[] = [];
  private readonly counters: Counter[] = [];

  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.gauges.push(g);
    return g;
  }

  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.counters.push(c);
    return c;
  }

  /** Prometheus text format (0.0.4). */
  render(): string {
    const parts = [
      ...this.gauges.map((g) => g.render()),
      ...this.counters.map((c) => c.render()),
    ];
    return parts.join('\n\n') + '\n';
  }
}

/** Shared default registry (process-local). */
export const defaultRegistry = new MetricsRegistry();

export const websocketActiveConnections = defaultRegistry.gauge(
  'websocket_active_connections',
  'Active realtime delivery sessions (SSE or WebSocket) on this instance',
);

export const httpRequestsTotal = defaultRegistry.counter(
  'http_requests_total',
  'Total HTTP requests handled by this instance',
);

export const realtimeTicketsIssuedTotal = defaultRegistry.counter(
  'realtime_tickets_issued_total',
  'Realtime tickets issued',
);
