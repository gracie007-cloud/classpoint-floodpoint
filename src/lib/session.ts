// src/lib/session.ts - Session management utilities

import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";

/**
 * Session cookie name
 */
const SESSION_COOKIE_NAME = "fp_session";

/**
 * Session cookie max age (24 hours in seconds)
 */
const SESSION_COOKIE_MAX_AGE = 24 * 60 * 60;

/**
 * Get or create a session ID from cookies
 * This function must be called from a Server Component or API Route
 */
export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existingSession = cookieStore.get(SESSION_COOKIE_NAME);
  
  if (existingSession?.value) {
    // Validate that it looks like a UUID
    if (isValidSessionId(existingSession.value)) {
      return existingSession.value;
    }
  }
  
  // Generate new session ID
  const newSessionId = uuidv4();
  
  cookieStore.set(SESSION_COOKIE_NAME, newSessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
  
  return newSessionId;
}

/**
 * Get session ID from request headers (for API routes)
 * Falls back to generating a temporary ID if none exists
 */
export async function getSessionIdFromRequest(request: Request): Promise<string> {
  // Try to get from cookie header
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const sessionId = cookies[SESSION_COOKIE_NAME];
    if (sessionId && isValidSessionId(sessionId)) {
      return sessionId;
    }
  }
  
  // For API routes, we need to use the cookies() function instead
  try {
    const cookieStore = await cookies();
    const existingSession = cookieStore.get(SESSION_COOKIE_NAME);
    if (existingSession?.value && isValidSessionId(existingSession.value)) {
      return existingSession.value;
    }
    
    // Create a new session
    const newSessionId = uuidv4();
    cookieStore.set(SESSION_COOKIE_NAME, newSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: "/",
    });
    
    return newSessionId;
  } catch {
    // If we can't access cookies (e.g., middleware context), generate temporary ID
    return `temp-${uuidv4()}`;
  }
}

/**
 * Validate that a session ID looks valid
 */
function isValidSessionId(id: string): boolean {
  // UUID v4 format or temp- prefix format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const tempRegex = /^temp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) || tempRegex.test(id);
}

/**
 * Parse cookie header string into key-value object
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(";").forEach((cookie) => {
    const [key, ...valueParts] = cookie.trim().split("=");
    if (key && valueParts.length > 0) {
      cookies[key.trim()] = valueParts.join("=").trim();
    }
  });
  
  return cookies;
}

/**
 * Create a session ID response header
 */
export function createSessionCookie(sessionId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE}; Path=/${secure}`;
}
