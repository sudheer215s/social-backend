import { ConfigValidationError, configToJSON, loadConfig } from './config';

const validEnv = {
  NODE_ENV: 'test',
  SERVICE_NAME: 'hello-service',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/social',
  DATABASE_POOL_MAX: '5',
  REDIS_URL: 'redis://localhost:6379',
  KAFKA_BROKERS: 'localhost:9092,localhost:9093',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  // secret-shaped keys that must never appear in JSON dumps
  DATABASE_PASSWORD: 'super-secret',
  API_TOKEN: 'tok_123',
  JWT_SECRET_KEY: 'shh',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('parses a valid environment into typed config', () => {
    const cfg = loadConfig(validEnv);

    expect(cfg.NODE_ENV).toBe('test');
    expect(cfg.SERVICE_NAME).toBe('hello-service');
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(cfg.DATABASE_POOL_MAX).toBe(5);
    expect(cfg.REDIS_URL).toBe(validEnv.REDIS_URL);
    expect(cfg.KAFKA_BROKERS).toEqual(['localhost:9092', 'localhost:9093']);
    expect(cfg.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318');
  });

  it('defaults LOG_LEVEL and DATABASE_POOL_MAX', () => {
    const rest = { ...validEnv };
    delete rest.LOG_LEVEL;
    delete rest.DATABASE_POOL_MAX;
    const cfg = loadConfig(rest);

    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.DATABASE_POOL_MAX).toBe(5);
  });

  it('fails fast when required fields are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
    try {
      loadConfig({});
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const issues = (err as ConfigValidationError).issues;
      expect(issues.length).toBeGreaterThan(0);
      const paths = issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining([
          'NODE_ENV',
          'SERVICE_NAME',
          'DATABASE_URL',
          'REDIS_URL',
          'KAFKA_BROKERS',
          'OTEL_EXPORTER_OTLP_ENDPOINT',
        ]),
      );
    }
  });

  it('rejects DATABASE_POOL_MAX above the PgBouncer cap of 10', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_POOL_MAX: '11' })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects empty SERVICE_NAME', () => {
    expect(() => loadConfig({ ...validEnv, SERVICE_NAME: '' })).toThrow(
      ConfigValidationError,
    );
  });

  it('trims Kafka broker entries', () => {
    const cfg = loadConfig({
      ...validEnv,
      KAFKA_BROKERS: ' broker-a:9092 , broker-b:9092 ',
    });
    expect(cfg.KAFKA_BROKERS).toEqual(['broker-a:9092', 'broker-b:9092']);
  });
});

describe('configToJSON', () => {
  it('redacts keys matching pass|secret|token|key', () => {
    const cfg = loadConfig(validEnv);
    const json = configToJSON(cfg, {
      DATABASE_PASSWORD: 'super-secret',
      API_TOKEN: 'tok_123',
      JWT_SECRET_KEY: 'shh',
      SAFE_FIELD: 'ok',
    });

    expect(json.DATABASE_PASSWORD).toBe('[REDACTED]');
    expect(json.API_TOKEN).toBe('[REDACTED]');
    expect(json.JWT_SECRET_KEY).toBe('[REDACTED]');
    expect(json.SAFE_FIELD).toBe('ok');
    expect(json.SERVICE_NAME).toBe('hello-service');
    expect(json.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });
});
