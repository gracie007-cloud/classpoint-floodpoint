"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ValidClassCode, ScanProgress, ScanResultsResponse } from "@/src/types";

interface UseScannerReturn {
  results: ValidClassCode[];
  isScanning: boolean;
  isLoading: boolean;
  message: string | null;
  progress: ScanProgress | null;
  startScan: (start?: number, end?: number) => Promise<void>;
  stopScan: () => Promise<void>;
  clearResults: () => void;
}

/**
 * Custom hook for managing the ClassPoint scanner
 * Enhanced with session isolation support and progress tracking
 */
export function useScanner(): UseScannerReturn {
  const [results, setResults] = useState<ValidClassCode[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isScanningRef = useRef(false);
  const isUnmountedRef = useRef(false);

  const fetchResults = useCallback(async () => {
    // Don't fetch if component is unmounted
    if (isUnmountedRef.current) return;

    try {
      const response = await fetch("/api/scanner/results", {
        credentials: "include", // Ensure session cookie is sent
      });
      
      if (!response.ok) {
        console.error("Error fetching results:", response.status);
        return;
      }
      
      const data: ScanResultsResponse = await response.json();
      
      // Don't update state if component is unmounted
      if (isUnmountedRef.current) return;
      
      setResults(data.results || []);
      
      if (data.progress) {
        setProgress(data.progress);
      }

      // Always sync scanning state from server
      if (data.isScanning !== isScanningRef.current) {
        isScanningRef.current = data.isScanning;
        setIsScanning(data.isScanning);
      }

      // Check if scan has just completed
      if (data.isScanning === false && !pollingIntervalRef.current && data.message) {
         setMessage(data.message);
      } else if (data.isScanning === false && isScanningRef.current === false) {
         // Stop polling if server says done
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            setMessage(
                data.message || 
                `Scan completed. Found ${data.results?.length || 0} active session(s).`
            );
          }
      }
    } catch (error) {
      console.error("Error fetching results:", error);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    // Fetch immediately
    fetchResults();
    // Then poll every 2 seconds
    pollingIntervalRef.current = setInterval(fetchResults, 2000);
  }, [fetchResults]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

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
        credentials: "include", // Ensure session cookie is sent
        body: JSON.stringify({ start, end }),
      });

      const data = await response.json();

      if (response.status === 429) {
        // Rate limited
        setMessage(`Too many requests. Please wait ${data.retryAfter || 60} seconds.`);
        return;
      }

      if (data.started) {
        isScanningRef.current = true;
        setIsScanning(true);
        setMessage(data.message || "Scan started.");
        startPolling();
      } else {
        setMessage(data.message || "Failed to start scan.");
      }
    } catch (error) {
      console.error("Error starting scan:", error);
      setMessage("Error initiating scan. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, startPolling]);

  const stopScan = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/scanner/stop", {
        method: "POST",
        credentials: "include", // Ensure session cookie is sent
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
        // Fetch final results
        await fetchResults();
      } else {
        setMessage(data.message || "No scan was running.");
      }
    } catch (error) {
      console.error("Error stopping scan:", error);
      setMessage("Error stopping scan.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, stopPolling, fetchResults]);

  const clearResults = useCallback(() => {
    setResults([]);
    setMessage(null);
    setProgress(null);
  }, []);

  // Cleanup on unmount - also stop the scan
  useEffect(() => {
    isUnmountedRef.current = false;
    
    return () => {
      isUnmountedRef.current = true;
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      // Stop the scan when user leaves the page
      if (isScanningRef.current) {
        fetch("/api/scanner/stop", {
          method: "POST",
          credentials: "include",
          // Use keepalive to ensure request completes even after unmount
          keepalive: true,
        }).catch(console.error);
      }
    };
  }, []);

  // Check initial state on mount
  useEffect(() => {
    const checkInitialState = async () => {
      try {
        const response = await fetch("/api/scanner/results", {
          credentials: "include",
        });
        
        if (response.ok) {
          const data: ScanResultsResponse = await response.json();
          if (data.isScanning) {
            isScanningRef.current = true;
            setIsScanning(true);
            setResults(data.results || []);
            if (data.progress) {
              setProgress(data.progress);
            }
            startPolling();
          }
        }
      } catch (error) {
        console.error("Error checking initial state:", error);
      }
    };
    checkInitialState();
  }, [startPolling]);

  return {
    results,
    isScanning,
    isLoading,
    message,
    progress,
    startScan,
    stopScan,
    clearResults,
  };
}
