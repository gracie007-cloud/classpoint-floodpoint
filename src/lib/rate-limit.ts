// src/lib/rate-limit.ts - Rate limiting utilities for API protection

/**
 * Simple in-memory rate limiter using sliding window approach
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Optional identifier for logging */
  name?: string;
}

/**
 * Rate limiter class using sliding window algorithm
 */
export class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private config: RateLimiterConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    // Cleanup old entries periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), config.windowMs);
  }

  /**
   * Check if a request should be allowed
   * @param key - Unique identifier (e.g., IP address, session ID)
   * @returns Object with allowed status and remaining requests
   */
  check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      // New window
      this.requests.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetIn: this.config.windowMs,
      };
    }

    // Within current window
    const remaining = this.config.maxRequests - entry.count - 1;
    const resetIn = this.config.windowMs - (now - entry.windowStart);

    if (entry.count >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetIn,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.windowStart >= this.config.windowMs) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.requests.delete(key);
    }
  }

  /**
   * Dispose the rate limiter and clean up resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }

  /**
   * Get the current count of tracked keys
   */
  get size(): number {
    return this.requests.size;
  }
}

// Pre-configured rate limiters for different endpoints
export const scannerRateLimiter = new RateLimiter({
  maxRequests: 5,       // 5 scan starts per window
  windowMs: 60 * 1000,  // 1 minute
  name: "scanner",
});

export const lookupRateLimiter = new RateLimiter({
  maxRequests: 60,       // 60 lookups per window
  windowMs: 60 * 1000,   // 1 minute
  name: "lookup",
});

export const generalRateLimiter = new RateLimiter({
  maxRequests: 100,      // 100 requests per window
  windowMs: 60 * 1000,   // 1 minute
  name: "general",
});

/**
 * Validate IPv4 address format
 */
function isValidIPv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
}

/**
 * Validate IPv6 address format (simplified)
 */
function isValidIPv6(ip: string): boolean {
  // Simplified IPv6 check - covers most common formats
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^([0-9a-fA-F]{1,4}:){1,7}:$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;
  return ipv6Regex.test(ip);
}

/**
 * Check if IP is valid
 */
function isValidIP(ip: string): boolean {
  return isValidIPv4(ip) || isValidIPv6(ip);
}

/**
 * Check if proxy headers should be trusted
 */
function shouldTrustProxy(): boolean {
  return process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1";
}

/**
 * Get client identifier from request (IP or fallback)
 * Only trusts X-Forwarded-For when TRUST_PROXY env var is set
 */
export function getClientId(request: Request): string {
  // Only trust forwarded headers when behind a known proxy
  if (shouldTrustProxy()) {
    // Try to get forwarded IP (for proxies/load balancers)
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0]?.trim();
      if (firstIp && isValidIP(firstIp)) {
        return firstIp;
      }
    }

    // Try real IP header
    const realIp = request.headers.get("x-real-ip");
    if (realIp && isValidIP(realIp.trim())) {
      return realIp.trim();
    }
  }

  // Fallback - use a cryptographic hash of request characteristics
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  const acceptLanguage = request.headers.get("accept-language") || "";
  const acceptEncoding = request.headers.get("accept-encoding") || "";
  
  return `anon-${secureHash(userAgent + accept + acceptLanguage + acceptEncoding)}`;
}

/**
 * Improved hash function using djb2 algorithm with salt
 */
function secureHash(str: string): string {
  // Add a timestamp-based salt that changes daily for some entropy
  const daySalt = Math.floor(Date.now() / (1000 * 60 * 60 * 24)).toString();
  const input = str + daySalt;
  
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

/**
 * Create rate limit headers for responses
 */
export function createRateLimitHeaders(
  remaining: number,
  resetIn: number,
  limit: number
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(Math.ceil(resetIn / 1000)),
  };
}

/**
 * Rate limit response helper
 */
export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please try again later.",
      retryAfter: Math.ceil(resetIn / 1000),
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(resetIn / 1000)),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

