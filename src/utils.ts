// src/utils.ts - Utility functions

import { v4 as uuidv4 } from "uuid";
import { DEFAULT_NAME_PREFIX } from "./config";

/**
 * Generates a unique username with the given prefix
 * @param prefix - The prefix for the username (defaults to DEFAULT_NAME_PREFIX)
 * @returns A unique username in format: prefix_xxxxxxxx
 */
export function generateUsername(prefix: string = DEFAULT_NAME_PREFIX): string {
  const sanitizedPrefix = prefix.trim() || DEFAULT_NAME_PREFIX;
  const uniqueSuffix = uuidv4().slice(0, 8);
  return `${sanitizedPrefix}_${uniqueSuffix}`;
}

/**
 * Generates a unique participant ID
 * @returns A unique participant ID in format: participant-uuid
 */
export function generateParticipantId(): string {
  return `participant-${uuidv4()}`;
}

/**
 * Safely parses an integer with a fallback value
 * @param value - The value to parse
 * @param fallback - The fallback value if parsing fails
 * @returns The parsed integer or the fallback
 */
export function safeParseInt(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : fallback;
  }
  
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  
  return fallback;
}

/**
 * Delays execution for a specified duration
 * @param ms - Duration in milliseconds
 * @returns A promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a debounced version of a function
 * @param fn - The function to debounce
 * @param delayMs - The delay in milliseconds
 * @returns The debounced function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Formats a connection status with appropriate styling class
 * @param status - The connection status
 * @returns CSS class names for the status
 */
export function getStatusClasses(status: string): {
  container: string;
  text: string;
  badge: string;
} {
  switch (status) {
    case "Connected":
      return {
        container: "",
        text: "text-foreground",
        badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      };
    case "Connecting":
      return {
        container: "",
        text: "text-foreground",
        badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
    case "Error":
      return {
        container: "",
        text: "text-foreground",
        badge: "bg-red-500/10 text-red-600 dark:text-red-400",
      };
    default:
      return {
        container: "",
        text: "text-muted-foreground",
        badge: "bg-secondary text-muted-foreground",
      };
  }
}

/**
 * Truncates a string to a maximum length with ellipsis
 * @param str - The string to truncate
 * @param maxLength - Maximum length
 * @returns The truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
