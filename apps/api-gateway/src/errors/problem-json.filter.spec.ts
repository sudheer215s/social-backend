import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { toProblem } from './problem-json.filter';
import type { Request } from 'express';
import { runWithRequestContext } from '@social/platform-telemetry';

function req(url = '/v1/posts'): Request {
  return { url, originalUrl: url, headers: {} } as Request;
}

describe('toProblem', () => {
  it('maps HttpException string body', () => {
    const p = toProblem(new HttpException('nope', 400), req());
    expect(p.status).toBe(400);
    expect(p.detail).toBe('nope');
    expect(p.instance).toBe('/v1/posts');
    expect(p.type).toBe('about:blank');
  });

  it('preserves problem-shaped bodies', () => {
    const p = toProblem(
      new ForbiddenException({
        type: 'https://api.social.example.com/problems/email-not-verified',
        title: 'Email not verified',
        status: 403,
        detail: 'Verify first',
      }),
      req('/v1/auth/x'),
    );
    expect(p.status).toBe(403);
    expect(p.type).toContain('email-not-verified');
    expect(p.title).toBe('Email not verified');
  });

  it('attaches traceId from ALS', () => {
    runWithRequestContext({ requestId: 'req-abc-12345' }, () => {
      const p = toProblem(new HttpException('x', 500), req());
      expect(p.traceId).toBe('req-abc-12345');
    });
  });

  it('maps unknown errors to 500', () => {
    const p = toProblem(new Error('boom'), req());
    expect(p.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(p.detail).toMatch(/unexpected/i);
  });
});
