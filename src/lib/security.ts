// src/lib/security.ts - Security utilities for API responses

/**
 * Standard security headers for API responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
} as const;

/**
 * Creates a JSON response with security headers
 */
export function secureJsonResponse(
  data: unknown,
  init?: ResponseInit
): Response {
  const headers = new Headers(init?.headers);
  
  // Add security headers
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

/**
 * Creates an error response with security headers
 */
export function secureErrorResponse(
  message: string,
  status: number = 500
): Response {
  return secureJsonResponse(
    { error: message },
    { status }
  );
}
