"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ValidClassCode, ScanProgress, ScanResultsResponse } from "@/src/types";

interface ScannerContextValue {
  results: ValidClassCode[];
  isScanning: boolean;
  isLoading: boolean;
  message: string | null;
  progress: ScanProgress | null;
  startScan: (start?: number, end?: number) => Promise<void>;
  stopScan: () => Promise<void>;
  clearResults: () => void;
}

const ScannerContext = createContext<ScannerContextValue | null>(null);

interface ScannerProviderProps {
  children: React.ReactNode;
}

/**
 * Heartbeat interval during active scanning (5 seconds)
 * Industry standard: WebSocket ping is typically 5-30s, we use 5s for responsive tab-close detection
 */
const HEARTBEAT_INTERVAL = 5000;

/**
 * Polling interval for results (2 seconds)
 */
const POLLING_INTERVAL = 2000;

/**
 * Scanner context provider - persists scanner state across navigation
 * Results persist permanently in React state until explicitly cleared
 */
export function ScannerProvider({ children }: ScannerProviderProps) {
  const [results, setResults] = useState<ValidClassCode[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isScanningRef = useRef(false);
  const isInitializedRef = useRef(false);

  // Send heartbeat to backend (only during active scan)
  const sendHeartbeat = useCallback(async () => {
    try {
      await fetch("/api/scanner/heartbeat", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.debug("[ScannerContext] Heartbeat error:", error);
    }
  }, []);

  // Start heartbeat (only when scanning)
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    sendHeartbeat();
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  }, [sendHeartbeat]);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Fetch results from backend
  const fetchResults = useCallback(async () => {
    try {
      const response = await fetch("/api/scanner/results", {
        credentials: "include",
      });

      if (!response.ok) {
        console.error("[ScannerContext] Error fetching results:", response.status);
        return;
      }

      const data: ScanResultsResponse = await response.json();

      // Always update results from backend
      if (data.results && data.results.length > 0) {
        setResults(data.results);
      }

      if (data.progress) {
        setProgress(data.progress);
      }

      // Check if scan has completed
      if (data.isScanning === false && isScanningRef.current) {
        isScanningRef.current = false;
        setIsScanning(false);
        setMessage(`Scan completed. Found ${data.results?.length || 0} active session(s).`);
        stopPolling();
        stopHeartbeat();
      }
    } catch (error) {
      console.error("[ScannerContext] Error fetching results:", error);
    }
  }, [stopPolling, stopHeartbeat]);

  // Start polling for results
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    fetchResults();
    pollingIntervalRef.current = setInterval(fetchResults, POLLING_INTERVAL);
  }, [fetchResults]);

  // Start a scan
  const startScan = useCallback(async (start = 10000, end = 99999) => {
    if (isLoading || isScanningRef.current) return;

    setIsLoading(true);
    setMessage(null);
    setResults([]);
    setProgress(null);

    try {
      const response = await fetch("/api/scanner/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ start, end }),
      });

      const data = await response.json();

      if (response.status === 429) {
        setMessage(`Too many requests. Please wait ${data.retryAfter || 60} seconds.`);
        return;
      }

      if (data.started) {
        isScanningRef.current = true;
        setIsScanning(true);
        setMessage(data.message || "Scan started.");
        startPolling();
        startHeartbeat();
      } else {
        setMessage(data.message || "Failed to start scan.");
      }
    } catch (error) {
      console.error("[ScannerContext] Error starting scan:", error);
      setMessage("Error initiating scan. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, startPolling, startHeartbeat]);

  // Stop a scan
  const stopScan = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/scanner/stop", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();

      if (data.stopped) {
        isScanningRef.current = false;
        setIsScanning(false);
        setMessage("Scan stopped.");
        if (data.progress) {
          setProgress(data.progress);
        }
        stopPolling();
        stopHeartbeat();
        // Fetch final results
        await fetchResults();
      } else {
        setMessage(data.message || "No scan was running.");
      }
    } catch (error) {
      console.error("[ScannerContext] Error stopping scan:", error);
      setMessage("Error stopping scan.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, stopPolling, stopHeartbeat, fetchResults]);

  // Clear results (user action)
  const clearResults = useCallback(() => {
    setResults([]);
    setMessage(null);
    setProgress(null);
  }, []);

  // Check initial state on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const checkInitialState = async () => {
      try {
        const response = await fetch("/api/scanner/results", {
          credentials: "include",
        });

        if (response.ok) {
          const data: ScanResultsResponse = await response.json();
          
          if (data.isScanning) {
            // Resume scanning state
            isScanningRef.current = true;
            setIsScanning(true);
            setResults(data.results || []);
            if (data.progress) {
              setProgress(data.progress);
            }
            startPolling();
            startHeartbeat();
          } else if (data.results && data.results.length > 0) {
            // Restore previous results (no heartbeat needed - they're just in React state)
            setResults(data.results);
          }
        }
      } catch (error) {
        console.error("[ScannerContext] Error checking initial state:", error);
      }
    };
    checkInitialState();
  }, [startPolling, startHeartbeat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopHeartbeat();
    };
  }, [stopPolling, stopHeartbeat]);

  const value: ScannerContextValue = {
    results,
    isScanning,
    isLoading,
    message,
    progress,
    startScan,
    stopScan,
    clearResults,
  };

  return (
    <ScannerContext.Provider value={value}>
      {children}
    </ScannerContext.Provider>
  );
}

/**
 * Hook to access scanner context
 */
export function useScannerContext(): ScannerContextValue {
  const context = useContext(ScannerContext);
  if (!context) {
    throw new Error("useScannerContext must be used within a ScannerProvider");
  }
  return context;
}
