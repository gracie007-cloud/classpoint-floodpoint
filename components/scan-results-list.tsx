"use client";

import type { ValidClassCode } from "@/src/types";
import { toast } from "sonner";

interface ScanResultsListProps {
  results: ValidClassCode[];
}

/**
 * Clean scan results list with copy feedback
 */
export function ScanResultsList({ results }: ScanResultsListProps) {
  if (results.length === 0) {
    return null;
  }

  const handleCopy = async (code: number) => {
    try {
      await navigator.clipboard.writeText(code.toString());
      toast.success("Code copied!", {
        description: `${code} copied to clipboard`,
        duration: 2000,
      });
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy", {
        duration: 2000,
      });
    }
  };

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">Found Sessions</h2>
        <span className="text-xs text-muted-foreground">
          {results.length} active
        </span>
      </div>
      
      <div className="border border-border rounded-lg overflow-hidden">
        <ul className="divide-y divide-border max-h-[320px] overflow-y-auto custom-scrollbar">
          {results.map((item) => (
            <li
              key={item.code}
              className="px-4 py-3 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors duration-150"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {item.code}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {item.email}
                </p>
              </div>
              <button
                onClick={() => handleCopy(item.code)}
                className="ml-3 p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors duration-150"
                title="Copy code"
                aria-label={`Copy class code ${item.code}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

ScanResultsList.displayName = "ScanResultsList";
