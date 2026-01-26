// src/logger.ts - Centralized logging utility with environment-aware behavior

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  /** Prefix for all log messages */
  prefix: string;
  /** Minimum log level in production */
  productionLevel: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  prefix: '',
  productionLevel: 'warn',
};

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Creates a logger instance with optional prefix
 */
function createLogger(config: Partial<LoggerConfig> = {}) {
  const { prefix, productionLevel } = { ...DEFAULT_CONFIG, ...config };
  const minLevel = isDev ? 0 : LOG_LEVELS[productionLevel];

  const formatMessage = (level: LogLevel, message: string): string => {
    const timestamp = new Date().toISOString();
    return prefix ? `[${timestamp}] [${prefix}] ${message}` : `[${timestamp}] ${message}`;
  };

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVELS[level] >= minLevel;
  };

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', message), ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (shouldLog('info')) {
        console.info(formatMessage('info', message), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', message), ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error(formatMessage('error', message), ...args);
      }
    },
  };
}

// Pre-configured loggers for different modules
export const logger = createLogger();
export const scannerLogger = createLogger({ prefix: 'Scanner' });
export const apiLogger = createLogger({ prefix: 'API' });
export const flooderLogger = createLogger({ prefix: 'Flooder' });

export { createLogger };
