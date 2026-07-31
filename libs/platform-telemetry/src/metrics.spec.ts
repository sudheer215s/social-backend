import {
  Counter,
  Gauge,
  MetricsRegistry,
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
});
