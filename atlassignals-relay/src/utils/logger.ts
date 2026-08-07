/**
 * logger.ts — pino logger factory.
 *
 * Pretty output is used only in local development; production and test emit
 * structured JSON logs that are cheap to ship anywhere.
 */
import pino, { type Logger } from 'pino';
import { loadEnv } from '../config/env';

export function createLogger(): Logger {
  const env = loadEnv();
  return pino({
    level: env.nodeEnv === 'production' ? 'info' : 'debug',
    base: { service: 'atlassignals-relay', version: env.version },
    ...(env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
      : {}),
  });
}

export const logger: Logger = createLogger();
