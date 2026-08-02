/**
 * Minimal Prometheus text exposition without external deps.
 * Process-local gauges/counters/histograms; scrape each pod via /metrics.
 */

export type Labels = Record<string, string>;

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
  private readonly values = new Map<
    string,
    { labels: Labels; value: number }
  >();

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
  private readonly values = new Map<
    string,
    { labels: Labels; value: number }
  >();

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

/** Cumulative histogram (Prometheus classic). Buckets are upper bounds in the same unit as observe(). */
export class Histogram {
  private readonly series = new Map<
    string,
    { labels: Labels; bucketCounts: number[]; sum: number; count: number }
  >();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[],
  ) {
    const sorted = [...buckets].sort((a, b) => a - b);
    if (sorted.some((b, i) => i > 0 && b === sorted[i - 1])) {
      throw new Error('histogram buckets must be unique');
    }
    (this as { buckets: readonly number[] }).buckets = sorted;
  }

  observe(value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    const key = labelsKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = {
        labels,
        // Per-bucket exclusive counts; render() makes them cumulative.
        bucketCounts: this.buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, s);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        s.bucketCounts[i]! += 1;
        break;
      }
    }
    s.sum += value;
    s.count += 1;
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    if (this.series.size === 0) {
      for (const le of this.buckets) {
        lines.push(`${this.name}_bucket{le="${le}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
      return lines.join('\n');
    }
    for (const s of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += s.bucketCounts[i]!;
        const le = this.buckets[i]!;
        const lbl = { ...s.labels, le: String(le) };
        lines.push(`${this.name}_bucket${formatLabels(lbl)} ${cumulative}`);
      }
      const infLbl = { ...s.labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLbl)} ${s.count}`);
      lines.push(`${this.name}_sum${formatLabels(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${formatLabels(s.labels)} ${s.count}`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly gauges: Gauge[] = [];
  private readonly counters: Counter[] = [];
  private readonly histograms: Histogram[] = [];

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

  histogram(name: string, help: string, buckets: readonly number[]): Histogram {
    const h = new Histogram(name, help, buckets);
    this.histograms.push(h);
    return h;
  }

  /** Prometheus text format (0.0.4). */
  render(): string {
    const parts = [
      ...this.gauges.map((g) => g.render()),
      ...this.counters.map((c) => c.render()),
      ...this.histograms.map((h) => h.render()),
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

/** RED: rate — total HTTP requests (labels: method, route, status_class). */
export const httpRequestsTotal = defaultRegistry.counter(
  'http_requests_total',
  'Total HTTP requests handled by this instance',
);

/** RED: errors — 5xx responses (labels: method, route). */
export const httpRequestErrorsTotal = defaultRegistry.counter(
  'http_request_errors_total',
  'HTTP 5xx responses handled by this instance',
);

/** RED: duration — request latency in seconds. */
export const httpRequestDurationSeconds = defaultRegistry.histogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export const realtimeTicketsIssuedTotal = defaultRegistry.counter(
  'realtime_tickets_issued_total',
  'Realtime tickets issued',
);

/**
 * Collapse high-cardinality path segments (UUIDs, long numeric ids) for metrics labels.
 */
export function normalizeHttpRoute(path: string): string {
  const bare = path.split('?')[0] ?? path;
  const normalized = bare
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:id',
    )
    .replace(/\/\d{6,}/g, '/:n')
    .replace(/\/{2,}/g, '/');
  if (!normalized || normalized === '/') return '/';
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

export function statusClass(statusCode: number): string {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}
