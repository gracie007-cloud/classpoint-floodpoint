// src/lib/session.ts - Session management utilities with signed cookies

import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { createHmac } from "crypto";

/**
 * Session cookie name
 */
const SESSION_COOKIE_NAME = "fp_session";

/**
 * Session cookie max age (24 hours in seconds)
 */
const SESSION_COOKIE_MAX_AGE = 24 * 60 * 60;

/**
 * Get session secret from environment or use fallback for development
 */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    console.warn("[Session] SESSION_SECRET not set in production!");
  }
  return secret || "dev-fallback-secret-change-in-production";
}

/**
 * Sign a session ID using HMAC-SHA256
 */
function signSessionId(sessionId: string): string {
  const hmac = createHmac("sha256", getSessionSecret());
  hmac.update(sessionId);
  const signature = hmac.digest("hex").slice(0, 16); // Use first 16 chars for brevity
  return `${sessionId}.${signature}`;
}

/**
 * Verify and extract session ID from signed value
 * Also handles backwards compatibility with old unsigned UUIDs
 */
function verifyAndExtractSessionId(signedValue: string): string | null {
  const parts = signedValue.split(".");
  
  // New format: sessionId.signature
  if (parts.length === 2) {
    const [sessionId, providedSignature] = parts;
    if (!sessionId || !providedSignature) {
      return null;
    }
    
    const hmac = createHmac("sha256", getSessionSecret());
    hmac.update(sessionId);
    const expectedSignature = hmac.digest("hex").slice(0, 16);
    
    // Constant-time comparison to prevent timing attacks
    if (providedSignature.length !== expectedSignature.length) {
      return null;
    }
    
    let isValid = true;
    for (let i = 0; i < providedSignature.length; i++) {
      if (providedSignature[i] !== expectedSignature[i]) {
        isValid = false;
      }
    }
    
    return isValid ? sessionId : null;
  }
  
  // Backwards compatibility: accept old unsigned UUIDs
  // This allows migration from unsigned to signed cookies
  if (parts.length === 1 && isValidSessionId(signedValue)) {
    return signedValue;
  }
  
  return null;
}

/**
 * Get or create a session ID from cookies
 * This function must be called from a Server Component or API Route
 */
export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existingSession = cookieStore.get(SESSION_COOKIE_NAME);
  
  if (existingSession?.value) {
    const sessionId = verifyAndExtractSessionId(existingSession.value);
    if (sessionId && isValidSessionId(sessionId)) {
      return sessionId;
    }
  }
  
  // Generate new session ID
  const newSessionId = uuidv4();
  const signedSessionId = signSessionId(newSessionId);
  
  cookieStore.set(SESSION_COOKIE_NAME, signedSessionId, {
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
    const parsedCookies = parseCookies(cookieHeader);
    const signedValue = parsedCookies[SESSION_COOKIE_NAME];
    if (signedValue) {
      const sessionId = verifyAndExtractSessionId(signedValue);
      if (sessionId && isValidSessionId(sessionId)) {
        return sessionId;
      }
    }
  }
  
  // For API routes, we need to use the cookies() function instead
  try {
    const cookieStore = await cookies();
    const existingSession = cookieStore.get(SESSION_COOKIE_NAME);
    if (existingSession?.value) {
      const sessionId = verifyAndExtractSessionId(existingSession.value);
      if (sessionId && isValidSessionId(sessionId)) {
        return sessionId;
      }
    }
    
    // Create a new session
    const newSessionId = uuidv4();
    const signedSessionId = signSessionId(newSessionId);
    cookieStore.set(SESSION_COOKIE_NAME, signedSessionId, {
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
  const result: Record<string, string> = {};
  
  cookieHeader.split(";").forEach((cookie) => {
    const [key, ...valueParts] = cookie.trim().split("=");
    if (key && valueParts.length > 0) {
      result[key.trim()] = valueParts.join("=").trim();
    }
  });
  
  return result;
}

/**
 * Create a session ID response header
 */
export function createSessionCookie(sessionId: string): string {
  const signedSessionId = signSessionId(sessionId);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${signedSessionId}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE}; Path=/${secure}`;
}

