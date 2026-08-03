import pino, { type Logger, type LoggerOptions } from 'pino';
import { redactSensitive } from './redact';
import { getRequestContext } from './request-context';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface CreateLoggerOptions {
  serviceName: string;
  level?: LogLevel;
  /** Override destination (tests). Defaults to stdout. */
  destination?: pino.DestinationStream;
}

/**
 * Structured JSON logger with automatic sensitive-field redaction.
 * When a request is in flight, attaches requestId from AsyncLocalStorage.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const level = options.level ?? 'info';

  const baseOptions: LoggerOptions = {
    level,
    base: {
      service: options.serviceName,
    },
    mixin() {
      const ctx = getRequestContext();
      if (!ctx?.requestId) return {};
      return {
        requestId: ctx.requestId,
        ...(ctx.traceparent ? { traceparent: ctx.traceparent } : {}),
      };
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    hooks: {
      logMethod(inputArgs, method) {
        if (inputArgs.length >= 1 && typeof inputArgs[0] === 'object') {
          const [first, ...rest] = inputArgs;
          // pino types: first may be merge object or Error
          const redacted = redactSensitive(first) as object;
          return method.apply(this, [redacted, ...rest] as Parameters<
            typeof method
          >);
        }
        return method.apply(this, inputArgs);
      },
    },
  };

  if (options.destination) {
    return pino(baseOptions, options.destination);
  }
  return pino(baseOptions);
}
