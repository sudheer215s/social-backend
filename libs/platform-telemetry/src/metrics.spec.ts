import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  normalizeHttpRoute,
  statusClass,
  websocketActiveConnections,
} from './metrics';

describe('metrics', () => {
  it('renders prometheus gauges and counters', () => {
    const reg = new MetricsRegistry();
    const g = reg.gauge('test_gauge', 'a gauge');
    const c = reg.counter('test_counter', 'a counter');
    g.set(3, { transport: 'ws' });
    c.inc(2, { route: '/x' });
    const text = reg.render();
    expect(text).toContain('# TYPE test_gauge gauge');
    expect(text).toContain('test_gauge{transport="ws"} 3');
    expect(text).toContain('test_counter{route="/x"} 2');
  });

  it('tracks websocket gauge up/down', () => {
    websocketActiveConnections.set(0, { transport: 'sse' });
    websocketActiveConnections.inc(1, { transport: 'sse' });
    websocketActiveConnections.inc(1, { transport: 'ws' });
    expect(websocketActiveConnections.get({ transport: 'sse' })).toBe(1);
    websocketActiveConnections.dec(1, { transport: 'sse' });
    expect(websocketActiveConnections.get({ transport: 'sse' })).toBe(0);
  });

  it('rejects negative counter increments', () => {
    const c = new Counter('c', 'c');
    expect(() => c.inc(-1)).toThrow(/cannot decrease/);
  });

  it('Gauge class standalone set', () => {
    const g = new Gauge('g', 'g');
    g.set(9);
    expect(g.get()).toBe(9);
  });

  it('renders histogram buckets', () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('lat', 'latency', [0.1, 0.5, 1]);
    h.observe(0.05, { method: 'GET' });
    h.observe(0.4, { method: 'GET' });
    h.observe(2, { method: 'GET' });
    const text = reg.render();
    expect(text).toContain('# TYPE lat histogram');
    expect(text).toContain('lat_bucket{le="0.1",method="GET"} 1');
    expect(text).toContain('lat_bucket{le="0.5",method="GET"} 2');
    expect(text).toContain('lat_bucket{le="+Inf",method="GET"} 3');
    expect(text).toContain('lat_count{method="GET"} 3');
  });

  it('normalizes routes for low cardinality', () => {
    expect(
      normalizeHttpRoute(
        '/v1/posts/018f0000-0000-7000-8000-000000000001/likes',
      ),
    ).toBe('/v1/posts/:id/likes');
    expect(normalizeHttpRoute('/v1/search?q=hi')).toBe('/v1/search');
    expect(statusClass(503)).toBe('5xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(200)).toBe('2xx');
  });
});
