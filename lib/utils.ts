import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge Tailwind CSS classes with proper precedence using clsx and tailwind-merge.
 * Handles conditional classes, arrays, and objects while resolving Tailwind conflicts.
 * @param inputs - Class values to merge (strings, arrays, objects, or conditionals)
 * @returns Merged and deduplicated class string
 * @example cn("px-2 py-1", condition && "bg-red-500", { "text-white": isActive })
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
