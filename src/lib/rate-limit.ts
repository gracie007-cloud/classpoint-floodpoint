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
 * Get client identifier from request (IP or fallback)
 */
export function getClientId(request: Request): string {
  // Try to get forwarded IP (for proxies/load balancers)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0];
    if (firstIp) {
      return firstIp.trim();
    }
  }

  // Try real IP header
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback - use a hash of user agent + accept headers
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  return `anonymous-${hashString(userAgent + accept)}`;
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
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
      },
    }
  );
}
