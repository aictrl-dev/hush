import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isDashboard = process.env.HUSH_DASHBOARD === 'true' || process.argv.includes('--dashboard');

/**
 * Pino level → Google Cloud Logging severity mapping.
 */
const severityMap: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * Root logger instance.
 *
 * - JSON output in production (compatible with Google Cloud Logging)
 * - pino-pretty in development for human-readable output
 * - Redacts sensitive fields (tokens, passwords, API keys)
 * - Configurable via LOG_LEVEL env var
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  formatters: {
    level(label: string) {
      return { severity: severityMap[label] || 'DEFAULT', level: label };
    },
  },
  redact: {
    paths: [
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'password',
      'idToken',
      'authorization',
      'secret',
      'clientSecret',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.password',
      '*.idToken',
      '*.authorization',
      '*.secret',
      '*.clientSecret',
    ],
    censor: '[REDACTED]',
  },
  // Security: In dashboard mode, we MUST avoid stdout/stderr to prevent TUI corruption.
  // We use standard pino-pretty for dev, and no transport for prod.
  transport: isDashboard 
    ? { target: 'pino/file', options: { destination: 'hush.log', mkdir: true } }
    : (isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } }),
});

/**
 * Create a child logger scoped to a component.
 *
 * @example
 * const log = createLogger('ws');
 * log.info({ clientId }, 'Client connected');
 */
export function createLogger(component: string) {
  return logger.child({ component });
}
