// src/config.ts - Application configuration

/**
 * Application version
 */
export const VERSION = "2.0.0";

/**
 * Environment detection for configuration defaults
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Default name prefix for bot usernames
 * Can be overridden by user input
 */
export const DEFAULT_NAME_PREFIX = "fp-bot";

/**
 * Scanner configuration - Parallel Streaming Architecture
 * Discovery and validation run simultaneously for real-time results
 */
export const SCANNER_CONFIG = {
  /** Minimum valid class code */
  START_CODE: 10000,
  /** Maximum valid class code */
  END_CODE: 99999,
  /** Optional domain filter for email collection */
  COLLECT_ONLY_DOMAIN: "",
  /** Maximum scan duration in milliseconds (30 minutes) */
  MAX_SCAN_DURATION: 30 * 60 * 1000,
  
  // Discovery Pool - Environment-aware for reliability across localhost and server
  /** Number of concurrent API requests - Optimized for connection pooling efficiency */
  DISCOVERY_CONCURRENCY: parseInt(process.env.SCANNER_CONCURRENCY ?? '') || (isProduction ? 250 : 500),
  /** Timeout for API requests (ms) - Adaptive timeout with optimized HTTPS agent */
  DISCOVERY_TIMEOUT: parseInt(process.env.SCANNER_TIMEOUT ?? '') || (isProduction ? 5000 : 2000),

  // Validation Pool - Parallel WebSocket validation (increased - WebSocket is I/O bound)
  /** Number of concurrent WebSocket connections - Higher since async I/O bound */
  VALIDATION_CONCURRENCY: parseInt(process.env.VALIDATION_CONCURRENCY ?? '') || 60,
  /** Maximum wait for WebSocket event (ms) - Allow more time for handshake */
  VALIDATION_TIMEOUT: parseInt(process.env.VALIDATION_TIMEOUT ?? '') || 5000,
} as const;

/**
 * Connection configuration
 */
export const CONNECTION_CONFIG = {
  /** Maximum number of concurrent connections */
  MAX_CONNECTIONS: 500,
  /** Minimum number of connections */
  MIN_CONNECTIONS: 1,
  /** Maximum length for name prefix */
  MAX_NAME_PREFIX_LENGTH: 20,
  /** Minimum length for name prefix */
  MIN_NAME_PREFIX_LENGTH: 1,
} as const;

/**
 * Flooder rate limiting configuration
 * Implements adaptive wave-based controller for intelligent rate management
 */
export const FLOODER_CONFIG = {
  /** Initial concurrent connection attempts */
  INITIAL_CONCURRENCY: 20,
  /** Maximum concurrent attempts during healthy periods */
  MAX_CONCURRENCY: 50,
  /** Minimum concurrent attempts during throttling */
  MIN_CONCURRENCY: 5,
  /** Connections per wave before health check */
  WAVE_SIZE: 50,
  /** Delay between waves (ms) */
  WAVE_DELAY: 2000,
  /** Base retry delay (ms) */
  RETRY_DELAY_BASE: 1000,
  /** Maximum retry delay cap (ms) */
  RETRY_DELAY_MAX: 15000,
  /** Maximum retries per connection */
  MAX_RETRIES: 3,
  /** Success rate threshold to increase concurrency (0-1) */
  HEALTHY_THRESHOLD: 0.9,
  /** Success rate threshold to decrease concurrency (0-1) */
  THROTTLE_THRESHOLD: 0.7,
  /** Success rate threshold to exit throttle state (0-1) - Hysteresis for smoother transitions */
  RECOVERY_THRESHOLD: 0.8,
  /** Connection timeout (ms) */
  CONNECTION_TIMEOUT: 10000,
  /** Sliding window size for health tracking */
  HEALTH_WINDOW_SIZE: 20,
} as const;

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  /** ClassPoint API base URL */
  CLASSPOINT_API: "https://apitwo.classpoint.app",
  /** ClassPoint class code lookup */
  CLASS_CODE_LOOKUP: (code: string | number) =>
    `https://apitwo.classpoint.app/classcode/region/byclasscode?classcode=${code}`,
  /** ClassPoint WebSocket URL */
  WEBSOCKET_URL: (region: string) => `https://${region}.classpoint.app/classsession`,
  /** ClassPoint validation URL */
  VALIDATE_JOIN_URL: (region: string, presenterEmail: string, classCode: string, participantId: string, username: string) =>
    `https://${region}.classpoint.app/liveclasses/validate-join?presenterEmail=${encodeURIComponent(
      presenterEmail
    )}&classCode=${encodeURIComponent(classCode)}&participantId=${encodeURIComponent(
      participantId
    )}&participantUsername=${encodeURIComponent(username)}`,
  /** ClassPoint saved participants lookup */
  SAVED_PARTICIPANTS_URL: (region: string, presenterEmail: string) =>
    `https://${region}.classpoint.app/liveclasses/saved-participants?email=${encodeURIComponent(presenterEmail)}`,
} as const;

/**
 * Validates a name prefix
 */
export function validateNamePrefix(prefix: string): { valid: boolean; error?: string } {
  const trimmed = prefix.trim();
  
  if (trimmed.length < CONNECTION_CONFIG.MIN_NAME_PREFIX_LENGTH) {
    return { valid: false, error: `Name prefix must be at least ${CONNECTION_CONFIG.MIN_NAME_PREFIX_LENGTH} character` };
  }
  
  if (trimmed.length > CONNECTION_CONFIG.MAX_NAME_PREFIX_LENGTH) {
    return { valid: false, error: `Name prefix must be at most ${CONNECTION_CONFIG.MAX_NAME_PREFIX_LENGTH} characters` };
  }
  
  // Only allow alphanumeric characters, underscores, and hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { valid: false, error: "Name prefix can only contain letters, numbers, underscores, and hyphens" };
  }
  
  return { valid: true };
}

/**
 * Validates connection count
 */
export function validateConnectionCount(count: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(count) || count < CONNECTION_CONFIG.MIN_CONNECTIONS) {
    return { valid: false, error: `Must have at least ${CONNECTION_CONFIG.MIN_CONNECTIONS} connection` };
  }
  
  if (count > CONNECTION_CONFIG.MAX_CONNECTIONS) {
    return { valid: false, error: `Cannot exceed ${CONNECTION_CONFIG.MAX_CONNECTIONS} connections` };
  }
  
  return { valid: true };
}

/**
 * Validates a class code
 */
export function validateClassCode(code: string, mode: 'guest' | 'restricted' = 'guest'): { valid: boolean; error?: string } {
  // 1. Basic type/empty check
  if (!code || typeof code !== 'string') {
    return { valid: false, error: "Class code is required" };
  }

  const trimmed = code.trim();

  // In restricted mode, allow alphanumeric codes (e.g., "GEO4A3O2")
  if (mode === 'restricted') {
    // Allow alphanumeric class codes (letters and numbers only)
    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
      return { valid: false, error: "Class code can only contain letters and numbers" };
    }

    // Length check: reasonable range for any class code
    if (trimmed.length < 3 || trimmed.length > 20) {
      return { valid: false, error: "Class code must be between 3 and 20 characters" };
    }

    return { valid: true };
  }

  // Guest mode: strict numeric validation for scanning
  // 2. Length check (ClassPoint codes are typically 5 digits)
  if (trimmed.length !== 5) {
    return { valid: false, error: "Class code must be exactly 5 digits" };
  }

  // 3. Strict numeric check using regex (prevent "12e3" or hex)
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: "Class code must contain only numbers" };
  }

  // 4. Numeric range check
  const numericCode = parseInt(trimmed, 10);
  if (numericCode < SCANNER_CONFIG.START_CODE || numericCode > SCANNER_CONFIG.END_CODE) {
    return { valid: false, error: `Class code must be between ${SCANNER_CONFIG.START_CODE} and ${SCANNER_CONFIG.END_CODE}` };
  }

  return { valid: true };
}
