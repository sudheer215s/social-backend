import { Writable } from 'node:stream';
import { createLogger } from './logger';
import { REDACTED_VALUE } from './redact';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = createLogger({
    serviceName: 'test-service',
    level: 'info',
    destination,
  });
  return {
    logger,
    lines,
    lastJson: () =>
      JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('createLogger', () => {
  it('emits JSON with service name', () => {
    const { logger, lastJson } = captureLogger();
    logger.info('hello');
    const row = lastJson();
    expect(row.service).toBe('test-service');
    expect(row.msg).toBe('hello');
    expect(row.level).toBe('info');
  });

  it('redacts sensitive fields on the merge object', () => {
    const { logger, lastJson } = captureLogger();
    logger.info(
      { email: 'a@b.com', password: 'x', userId: 'u1' },
      'login attempt',
    );
    const row = lastJson();
    expect(row.email).toBe(REDACTED_VALUE);
    expect(row.password).toBe(REDACTED_VALUE);
    expect(row.userId).toBe('u1');
    expect(row.msg).toBe('login attempt');
  });
});
