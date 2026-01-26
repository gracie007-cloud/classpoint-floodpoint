"use client";

import Image from "next/image";
import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { ConnectionList } from "@/components/connection-list";
import { useFlooder } from "@/hooks/use-flooder";
import { DEFAULT_NAME_PREFIX, CONNECTION_CONFIG } from "@/src/config";

export default function FlooderPage() {
  const [classCode, setClassCode] = useState("");
  const [numConnections, setNumConnections] = useState(1);
  const [namePrefix, setNamePrefix] = useState(""); // Empty by default

  const {
    connections,
    isConnecting,
    error,
    connect,
    disconnectAll,
    clearError,
  } = useFlooder({ namePrefix });

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

          {/* Form */}
          <div className="space-y-4">
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
            </div>
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
