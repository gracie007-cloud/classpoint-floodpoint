// src/lib/classpoint.ts - ClassPoint API utilities with improved error handling

import { API_ENDPOINTS } from "../config";

export interface ClassInfo {
  presenterEmail: string;
  cpcsRegion: string;
}

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT = 10000;

/**
 * Looks up class information by class code
 * @param classCode - The class code to look up
 * @returns ClassInfo if found, null otherwise
 */
export async function lookupClassCode(classCode: string | number): Promise<ClassInfo | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(API_ENDPOINTS.CLASS_CODE_LOOKUP(classCode), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Log non-404 errors for debugging
      if (response.status !== 404) {
        console.debug(`[ClassPoint] Lookup failed for code ${classCode}: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();

    // Validate required fields
    if (
      typeof data.presenterEmail !== "string" ||
      typeof data.cpcsRegion !== "string" ||
      !data.presenterEmail.trim() ||
      !data.cpcsRegion.trim()
    ) {
      console.debug(`[ClassPoint] Invalid response data for code ${classCode}`);
      return null;
    }

    return {
      presenterEmail: data.presenterEmail.trim(),
      cpcsRegion: data.cpcsRegion.trim(),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        console.debug(`[ClassPoint] Request timeout for code ${classCode}`);
      } else {
        console.debug(`[ClassPoint] Error looking up code ${classCode}:`, error.message);
      }
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validate a class session exists and is active
 * @param classCode - The class code
 * @param presenterEmail - The presenter's email
 * @param cpcsRegion - The region
 * @returns True if the session is valid
 */
export async function validateClassSession(
  classCode: string,
  presenterEmail: string,
  cpcsRegion: string
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Generate a temporary participant ID for validation
    const tempParticipantId = `validate-${Date.now()}`;
    const tempUsername = `validator-${Date.now()}`;

    const validateUrl = API_ENDPOINTS.VALIDATE_JOIN_URL(
      cpcsRegion,
      presenterEmail,
      classCode,
      tempParticipantId,
      tempUsername
    );

    const response = await fetch(validateUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded",
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch (error) {
    if (error instanceof Error) {
      console.debug(`[ClassPoint] Validation error for code ${classCode}:`, error.message);
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
