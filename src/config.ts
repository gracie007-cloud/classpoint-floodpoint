// src/config.ts - Application configuration

/**
 * Application version
 */
export const VERSION = "2.0.0";

/**
 * Default name prefix for bot usernames
 * Can be overridden by user input
 */
export const DEFAULT_NAME_PREFIX = "sigma";

/**
 * Scanner configuration
 */
export const SCANNER_CONFIG = {
  /** Minimum valid class code */
  START_CODE: 10000,
  /** Maximum valid class code */
  END_CODE: 99999,
  /** Duration to collect WebSocket data before disconnecting (ms) */
  WEBSOCKET_COLLECT_DURATION: 5000,
  /** Optional domain filter for email collection */
  COLLECT_ONLY_DOMAIN: "",
} as const;

/**
 * Connection configuration
 */
export const CONNECTION_CONFIG = {
  /** Maximum number of concurrent connections */
  MAX_CONNECTIONS: 100,
  /** Minimum number of connections */
  MIN_CONNECTIONS: 1,
  /** Maximum length for name prefix */
  MAX_NAME_PREFIX_LENGTH: 20,
  /** Minimum length for name prefix */
  MIN_NAME_PREFIX_LENGTH: 1,
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
/**
 * Validates a class code
 */
export function validateClassCode(code: string): { valid: boolean; error?: string } {
  // 1. Basic type/empty check
  if (!code || typeof code !== 'string') {
    return { valid: false, error: "Class code is required" };
  }

  const trimmed = code.trim();
  
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
