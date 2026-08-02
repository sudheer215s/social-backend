import {
  outboundRequestHeaders,
  parseTraceparent,
  runWithRequestContext,
  sanitizeRequestId,
  getRequestContext,
} from './request-context';

describe('request-context', () => {
  it('parses valid traceparent', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    expect(parseTraceparent(tp)).toBe(tp);
    expect(parseTraceparent('garbage')).toBeUndefined();
  });

  it('sanitizes request ids', () => {
    expect(sanitizeRequestId('abc')).toBeUndefined();
    expect(sanitizeRequestId('req-12345678')).toBe('req-12345678');
  });

  it('propagates via ALS', () => {
    runWithRequestContext(
      {
        requestId: 'r1',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      },
      () => {
        expect(getRequestContext()?.requestId).toBe('r1');
        expect(outboundRequestHeaders({ accept: 'application/json' })).toEqual({
          accept: 'application/json',
          'x-request-id': 'r1',
          traceparent:
            '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        });
      },
    );
  });
});
