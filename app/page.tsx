"use client";

import Image from "next/image";
import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { ConnectionList } from "@/components/connection-list";
import { useFlooder } from "@/hooks/use-flooder";
import { DEFAULT_NAME_PREFIX, CONNECTION_CONFIG } from "@/src/config";
import type { FlooderMode } from "@/src/types";

/**
 * Format milliseconds to human-readable time
 */
function formatTime(ms: number): string {
  if (ms < 1000) return "< 1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default function FlooderPage() {
  const [classCode, setClassCode] = useState("");
  const [numConnections, setNumConnections] = useState(1);
  const [namePrefix, setNamePrefix] = useState(""); // Empty by default
  const [mode, setMode] = useState<FlooderMode>("guest");
  const [excludedNames, setExcludedNames] = useState<string[]>([]);
  const [excludeInput, setExcludeInput] = useState("");

  const {
    connections,
    isConnecting,
    error,
    progress,
    connect,
    disconnectAll,
    clearError,
  } = useFlooder({ namePrefix, mode, excludedNames });

  const handleConnect = useCallback(async () => {
    await connect(classCode, numConnections);
  }, [classCode, numConnections, connect]);

  const handleNumConnectionsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setNumConnections(isNaN(value) ? 1 : Math.max(1, Math.min(value, CONNECTION_CONFIG.MAX_CONNECTIONS)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isConnecting && classCode.trim()) {
      handleConnect();
    }
  };

  const handleAddExcludedName = useCallback(() => {
    const trimmed = excludeInput.trim();
    if (trimmed && !excludedNames.includes(trimmed)) {
      setExcludedNames([...excludedNames, trimmed]);
      setExcludeInput("");
    }
  }, [excludeInput, excludedNames]);

  const handleRemoveExcludedName = useCallback((name: string) => {
    setExcludedNames(excludedNames.filter(n => n !== name));
  }, [excludedNames]);

  const handleExcludeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && excludeInput.trim()) {
      e.preventDefault();
      handleAddExcludedName();
    }
  };

  const canConnect = !isConnecting && classCode.trim().length > 0;
  const displayPrefix = namePrefix.trim() || DEFAULT_NAME_PREFIX;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="pt-8 pb-6 flex justify-center">
        <Navigation />
      </header>

      <main className="flex-1 flex flex-col items-center px-6">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-10">
            <Image
              src="/logo.svg"
              alt="Floodpoint - ClassPoint bot connection manager"
              width={280}
              height={60}
              priority
              className="mx-auto"
            />
            <p className="mt-4 text-muted-foreground text-sm">
              Create multiple bot connections to ClassPoint sessions.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-6 flex items-start gap-3 p-4 rounded-lg bg-red-500/5 border border-red-500/20 animate-fade-in"
              role="alert"
            >
              <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <p className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</p>
              <button onClick={clearError} className="text-red-400 hover:text-red-500 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Progress Indicator */}
          {progress && isConnecting && (
            <div className="mb-6 p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{progress.connected + progress.failed} / {progress.totalRequested}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      progress.waitingForRetry ? 'bg-amber-500 animate-pulse' : 'bg-[hsl(var(--fp-sky))]'
                    }`}
                    style={{ width: `${((progress.connected + progress.failed) / progress.totalRequested) * 100}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="space-y-0.5">
                  <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{progress.connected}</div>
                  <div className="text-xs text-muted-foreground">Connected</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{progress.connecting + progress.retrying}</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-lg font-semibold text-red-600 dark:text-red-400">{progress.failed}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              {/* Status row */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Wave {progress.waveNumber}</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">Concurrency: {progress.currentConcurrency}</span>
                  {progress.averageLatency && progress.averageLatency > 0 && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground">Latency: {Math.round(progress.averageLatency)}ms</span>
                    </>
                  )}
                </div>
                {progress.isThrottled && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Rate Limited
                  </span>
                )}
              </div>

              {/* Waiting/Cooldown indicator */}
              {(progress.waitingForRetry || progress.inCooldown) && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    {progress.inCooldown
                      ? `Cooling down: ${formatTime(progress.cooldownRemaining || 0)}`
                      : `Retry in: ${formatTime(progress.nextRetryIn || 0)}`}
                  </span>
                </div>
              )}

              {/* Status message */}
              {progress.statusMessage && (
                <div className="text-xs text-center text-muted-foreground italic">
                  {progress.statusMessage}
                </div>
              )}

              {/* ETA */}
              {progress.estimatedTimeRemaining !== null && (
                <div className="text-xs text-muted-foreground text-center">
                  Est. remaining: {formatTime(progress.estimatedTimeRemaining)}
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <div className="space-y-4">
            {/* Mode Selection */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Mode
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMode("guest")}
                  disabled={isConnecting}
                  className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all duration-150 ${
                    mode === "guest"
                      ? "bg-[hsl(var(--fp-sky))] text-white"
                      : "bg-secondary text-foreground hover:bg-secondary/80"
                  } ${isConnecting ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  Guest Mode
                </button>
                <button
                  type="button"
                  onClick={() => setMode("restricted")}
                  disabled={isConnecting}
                  className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all duration-150 ${
                    mode === "restricted"
                      ? "bg-[hsl(var(--fp-sky))] text-white"
                      : "bg-secondary text-foreground hover:bg-secondary/80"
                  } ${isConnecting ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  Restricted Mode
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "guest"
                  ? "Flood with any custom names"
                  : "Use only registered participant names from the class"}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="classCode" className="text-sm font-medium text-foreground">
                Class Code
              </label>
              <Input
                type="text"
                id="classCode"
                placeholder="e.g. 12345"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-10"
              />
            </div>

            {mode === "guest" ? (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="namePrefix" className="text-sm font-medium text-foreground">
                    Bot Name Prefix
                  </label>
                  <Input
                    type="text"
                    id="namePrefix"
                    placeholder={DEFAULT_NAME_PREFIX}
                    value={namePrefix}
                    onChange={(e) => setNamePrefix(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={CONNECTION_CONFIG.MAX_NAME_PREFIX_LENGTH}
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Bots will be named: <span className="font-mono text-foreground">{displayPrefix}_xxxxxxxx</span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="numConnections" className="text-sm font-medium text-foreground">
                    Number of Bots
                  </label>
                  <Input
                    type="number"
                    id="numConnections"
                    min={1}
                    max={CONNECTION_CONFIG.MAX_CONNECTIONS}
                    value={numConnections}
                    onChange={handleNumConnectionsChange}
                    onKeyDown={handleKeyDown}
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum: {CONNECTION_CONFIG.MAX_CONNECTIONS} bots
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Exclude Participants (Optional)
                </label>

                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Enter name to exclude"
                    value={excludeInput}
                    onChange={(e) => setExcludeInput(e.target.value)}
                    onKeyDown={handleExcludeKeyDown}
                    disabled={isConnecting}
                    className="h-10"
                  />
                  <button
                    type="button"
                    onClick={handleAddExcludedName}
                    disabled={!excludeInput.trim() || isConnecting}
                    className={`px-4 h-10 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                      !excludeInput.trim() || isConnecting
                        ? "bg-secondary text-muted-foreground cursor-not-allowed"
                        : "bg-[hsl(var(--fp-sky))] text-white hover:bg-[hsl(var(--fp-ocean))]"
                    }`}
                  >
                    Add
                  </button>
                </div>

                {excludedNames.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-secondary/30 border border-border">
                    {excludedNames.map((name) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background border border-border text-sm"
                      >
                        <span className="text-foreground">{name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveExcludedName(name)}
                          disabled={isConnecting}
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          aria-label={`Remove ${name}`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {excludedNames.length > 0
                    ? `Will flood with all registered participants except ${excludedNames.length} excluded`
                    : "Will flood with all registered participants"}
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={handleConnect}
              disabled={!canConnect}
              className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all duration-150 ${
                !canConnect
                  ? "bg-secondary text-muted-foreground cursor-not-allowed"
                  : "bg-[hsl(var(--fp-sky))] text-white hover:bg-[hsl(var(--fp-ocean))]"
              }`}
            >
              {isConnecting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connecting
                </span>
              ) : (
                "Open Floodgates"
              )}
            </button>

            {connections.length > 0 && (
              <button
                type="button"
                onClick={disconnectAll}
                className="px-4 h-10 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-secondary transition-colors duration-150"
              >
                Disconnect
              </button>
            )}
          </div>

          {connections.length > 0 && (
            <div className="mt-6">
              <ConnectionList connections={connections} />
            </div>
          )}
        </div>
      </main>

      <footer className="py-8 text-center">
        <Footer />
      </footer>
    </div>
  );
}
