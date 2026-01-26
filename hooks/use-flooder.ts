"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as signalR from "@microsoft/signalr";
import type { ConnectionInfo, ConnectionStatus } from "@/src/types";
import { generateUsername, generateParticipantId } from "@/src/utils";
import { API_ENDPOINTS, DEFAULT_NAME_PREFIX, CONNECTION_CONFIG, validateNamePrefix } from "@/src/config";
import { flooderLogger as logger } from "@/src/logger";

interface ClassInfo {
  presenterEmail: string;
  cpcsRegion: string;
}

interface UseFlooderOptions {
  namePrefix?: string;
}

interface UseFlooderReturn {
  connections: ConnectionInfo[];
  isConnecting: boolean;
  error: string | null;
  connect: (classCode: string, numConnections: number) => Promise<void>;
  disconnect: (connectionId?: number) => Promise<void>;
  disconnectAll: () => Promise<void>;
  clearError: () => void;
}

/**
 * Max concurrent connection attempts
 */
const CONCURRENCY_LIMIT = 10;

/**
 * Min time between UI updates in ms to prevent freezing
 */
const UI_UPDATE_THROTTLE_MS = 100;

/**
 * Custom hook for managing ClassPoint flooder connections
 * Optimized for high concurrency and performance
 */
export function useFlooder({ namePrefix }: UseFlooderOptions = {}): UseFlooderReturn {
  // UI State - decoupled from internal tracking
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mutable refs for high-speed tracking without re-renders
  const connectionsMap = useRef<Map<number, ConnectionInfo>>(new Map());
  const nextIdRef = useRef(1);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(false);
  const pendingUpdatesRef = useRef(false);
  
  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cleanup all connections on unmount
      const conns = Array.from(connectionsMap.current.values());
      conns.forEach(c => c.connection.stop().catch(() => {}));
    };
  }, []);

  // Throttled UI updater
  useEffect(() => {
    const flushUpdates = () => {
      if (!isMountedRef.current) return;
      
      if (pendingUpdatesRef.current) {
        setConnections(Array.from(connectionsMap.current.values()));
        pendingUpdatesRef.current = false;
      }
    };

    const interval = setInterval(flushUpdates, UI_UPDATE_THROTTLE_MS);
    return () => clearInterval(interval);
  }, []);

  // Helper to schedule a UI update
  const scheduleUpdate = useCallback(() => {
    pendingUpdatesRef.current = true;
  }, []);

  const createConnection = useCallback(async (
    id: number,
    url: string,
    cpcsRegion: string,
    presenterEmail: string,
    prefix: string
  ): Promise<void> => {
    const username = generateUsername(prefix);
    const participantId = generateParticipantId();

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        transport: signalR.HttpTransportType.WebSockets,
        withCredentials: true,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.None) // Disable verbose logs for performance
      .build();

    const info: ConnectionInfo = {
      id,
      username,
      participantId,
      connection,
      status: "Connecting"
    };

    // Add to map immediately
    connectionsMap.current.set(id, info);
    scheduleUpdate();

    connection.on("SendJoinClass", () => {
      // Optional: Log join if needed, keeping silent for perf
    });

    connection.onclose(() => {
      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Disconnected";
        scheduleUpdate();
      }
    });

    connection.onreconnecting(() => {
      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Connecting";
        scheduleUpdate();
      }
    });

    connection.onreconnected(() => {
      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Connected";
        scheduleUpdate();
      }
    });

    try {
      await connection.start();

      await connection.send("Send", { protocol: "json", version: 1 });
      await connection.send("ParticipantStartup", {
        participantUsername: username,
        participantName: username,
        participantId: participantId,
        participantAvatar: "",
        cpcsRegion: cpcsRegion,
        presenterEmail: presenterEmail,
        classSessionId: "",
      });

      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Connected";
        scheduleUpdate();
      }
    } catch (err) {
      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Error";
        scheduleUpdate();
      }
      logger.error(`Bot ${id} error:`, err);
    }
  }, [scheduleUpdate]);

  const connect = useCallback(async (classCode: string, numConnections: number) => {
    if (isConnectingRef.current) return;

    const trimmedCode = classCode.trim();
    if (!trimmedCode) {
      setError("Class code is required");
      return;
    }

    if (numConnections < CONNECTION_CONFIG.MIN_CONNECTIONS || numConnections > CONNECTION_CONFIG.MAX_CONNECTIONS) {
      setError(`Number of connections must be between ${CONNECTION_CONFIG.MIN_CONNECTIONS} and ${CONNECTION_CONFIG.MAX_CONNECTIONS}`);
      return;
    }

    const effectivePrefix = namePrefix?.trim() || DEFAULT_NAME_PREFIX;
    const prefixValidation = validateNamePrefix(effectivePrefix);
    if (!prefixValidation.valid) {
      setError(prefixValidation.error ?? "Invalid name prefix");
      return;
    }

    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/classpoint/lookup?code=${encodeURIComponent(trimmedCode)}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Class not found");
      }

      const classInfo: ClassInfo = await response.json();
      const { cpcsRegion, presenterEmail } = classInfo;
      const url = API_ENDPOINTS.WEBSOCKET_URL(cpcsRegion);

      // Sliding window implementation
      const pool = new Set<Promise<void>>();
      const tasks: (() => Promise<void>)[] = [];

      // Prepare tasks
      for (let i = 0; i < numConnections; i++) {
        tasks.push(() => {
          const id = nextIdRef.current++;
          return createConnection(id, url, cpcsRegion, presenterEmail, effectivePrefix);
        });
      }

      // Execute with concurrency limit
      for (const task of tasks) {
        // Stop if user cancelled or unmounted (could implement abort controller here later)
        if (!isMountedRef.current) break;

        const p = task().then(() => {
          pool.delete(p);
        });
        pool.add(p);

        if (pool.size >= CONCURRENCY_LIMIT) {
          await Promise.race(pool);
        }
      }

      // Wait for remaining
      await Promise.all(pool);
      
      logger.info(`Finished creating ${numConnections} connections`);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Connection failed";
      setError(errorMessage);
      logger.error("Connection flow error:", err);
    } finally {
      if (isMountedRef.current) {
        isConnectingRef.current = false;
        setIsConnecting(false);
      }
    }
  }, [namePrefix, createConnection]);

  const disconnect = useCallback(async (connectionId?: number) => {
    if (connectionId === undefined) return;

    const conn = connectionsMap.current.get(connectionId);
    if (conn) {
      await conn.connection.stop().catch(() => {});
      connectionsMap.current.delete(connectionId);
      scheduleUpdate();
    }
  }, [scheduleUpdate]);

  const disconnectAll = useCallback(async () => {
    const allConns = Array.from(connectionsMap.current.values());
    
    // Clear map immediately so UI feels responsive
    connectionsMap.current.clear();
    scheduleUpdate();

    // Stop connections in background
    await Promise.allSettled(
      allConns.map(c => c.connection.stop().catch(() => {}))
    );
  }, [scheduleUpdate]);

  const clearError = useCallback(() => setError(null), []);

  return {
    connections,
    isConnecting,
    error,
    connect,
    disconnect,
    disconnectAll,
    clearError,
  };
}
