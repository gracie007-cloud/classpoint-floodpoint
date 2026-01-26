"use client";

import Image from "next/image";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { ScanResultsList } from "@/components/scan-results-list";
import { useScannerContext } from "@/contexts/scanner-context";
import { SCANNER_CONFIG } from "@/src/config";

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Calculate scan progress percentage
 */
function calculateProgress(
  scannedCount: number,
  totalCodes: number
): number {
  if (totalCodes === 0) return 0;
  return Math.min(100, Math.round((scannedCount / totalCodes) * 100));
}

export default function ScannerPage() {
  const {
    results,
    isScanning,
    isLoading,
    message,
    progress,
    startScan,
    stopScan,
  } = useScannerContext();

  const handleStartScan = async () => {
    await startScan(SCANNER_CONFIG.START_CODE, SCANNER_CONFIG.END_CODE);
  };

  const handleStopScan = async () => {
    await stopScan();
  };

  const isError = message?.includes("Error") || message?.includes("Failed") || message?.includes("Too many");
  const canStart = !isLoading && !isScanning;
  const canStop = isScanning && !isLoading;

  const totalCodes = SCANNER_CONFIG.END_CODE - SCANNER_CONFIG.START_CODE + 1;
  const progressPercent = progress 
    ? calculateProgress(progress.scannedCount, totalCodes) 
    : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <header className="pt-8 pb-6 flex justify-center">
        <Navigation />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center px-6">
        <div className="w-full max-w-md">
          {/* Logo & Description */}
          <div className="text-center mb-8">
            <Image
              src="/logo.svg"
              alt="Floodpoint - ClassPoint session scanner"
              width={280}
              height={60}
              priority
              className="mx-auto"
            />
            <p className="mt-4 text-muted-foreground text-sm">
              Scan for active ClassPoint sessions in the {SCANNER_CONFIG.START_CODE.toLocaleString()}–{SCANNER_CONFIG.END_CODE.toLocaleString()} range.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-6">
            <button
              type="button"
              onClick={handleStartScan}
              disabled={!canStart}
              className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all duration-150 ${
                !canStart
                  ? "bg-secondary text-muted-foreground cursor-not-allowed"
                  : "bg-[hsl(var(--fp-sky))] text-white hover:bg-[hsl(var(--fp-ocean))]"
              }`}
            >
              {isLoading && !isScanning ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Starting
                </span>
              ) : isScanning ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning
                </span>
              ) : (
                "Start Scan"
              )}
            </button>

            <button
              type="button"
              onClick={handleStopScan}
              disabled={!canStop}
              className={`px-5 h-10 rounded-lg text-sm font-medium border transition-colors duration-150 ${
                !canStop
                  ? "border-border text-muted-foreground cursor-not-allowed opacity-50"
                  : "border-border text-foreground hover:bg-secondary"
              }`}
            >
              Stop
            </button>
          </div>

          {/* Progress indicator */}
          {isScanning && progress && (
            <div className="mb-6 space-y-3 animate-fade-in">
              {/* Progress bar */}
              <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="absolute inset-y-0 left-0 bg-[hsl(var(--fp-sky))] transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              
              {/* Stats row */}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  Scanned: <span className="font-medium text-foreground">{progress.scannedCount.toLocaleString()}</span> / {totalCodes.toLocaleString()}
                </span>
                <span>
                  {progressPercent}%
                </span>
              </div>

              {/* Additional info */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Currently checking: <span className="font-mono text-foreground">{progress.currentCode}</span>
                </span>
                {progress.elapsedMs && (
                  <span className="text-muted-foreground">
                    {formatElapsedTime(progress.elapsedMs)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Found sessions counter */}
          {isScanning && (
            <div className="mb-6 p-3 rounded-lg bg-secondary text-center animate-fade-in">
              <span className="text-sm text-foreground">
                Found <span className="font-medium text-[hsl(var(--fp-sky))]">{results.length}</span> {results.length === 1 ? "session" : "sessions"}
              </span>
            </div>
          )}

          {/* Message */}
          {message && !isScanning && (
            <div
              className={`mb-6 p-3 rounded-lg text-sm text-center animate-fade-in ${
                isError
                  ? "bg-red-500/5 border border-red-500/20 text-red-600 dark:text-red-400"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {message}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="mb-6">
              <ScanResultsList results={results} />
            </div>
          )}

          {/* Empty state */}
          {!isScanning && results.length === 0 && !message && (
            <div className="text-center py-10 border border-dashed border-border rounded-lg">
              <svg
                className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <p className="text-sm text-muted-foreground">
                No active sessions found yet
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Click &quot;Start Scan&quot; to begin searching
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center">
        <Footer />
      </footer>
    </div>
  );
}
