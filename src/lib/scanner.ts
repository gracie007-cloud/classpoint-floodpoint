// src/lib/scanner.ts - Scanner module for finding active ClassPoint sessions
// Improved with: session isolation, concurrent scanning, proper error handling, and resource cleanup

import axios, { AxiosError } from "axios";
import type { ValidClassCode, WebSocketData, SendJoinClassPayload } from "../types";
import { generateUsername, generateParticipantId, delay } from "../utils";
import { SCANNER_CONFIG, API_ENDPOINTS, DEFAULT_NAME_PREFIX } from "../config";
import { scannerLogger as logger } from "../logger";

/**
 * Scanner state for a single session
 */
interface SessionScannerState {
  scanning: boolean;
  shouldStop: boolean;
  foundCodes: ValidClassCode[];
  startTime: number | null;
  currentCode: number | null;
  scannedCount: number;
  lastHeartbeat: number;
}

/**
 * Session storage - isolated state per session
 * Uses globalThis to ensure singleton pattern across Next.js HMR/reloads
 */
const globalWithScanner = global as typeof globalThis & {
  _scannerSessions?: Map<string, SessionScannerState>;
};

if (!globalWithScanner._scannerSessions) {
  globalWithScanner._scannerSessions = new Map<string, SessionScannerState>();
}

const sessions = globalWithScanner._scannerSessions;

/**
 * Maximum scan duration in milliseconds (30 minutes)
 */
const MAX_SCAN_DURATION = 30 * 60 * 1000;

/**
 * Heartbeat timeout for active scans - if no heartbeat for 15 seconds, stop the scan
 * (increased from 10s to account for browser throttling when tab is in background)
 */
const SCAN_HEARTBEAT_TIMEOUT = 15 * 1000;

/**
 * Session cleanup timeout - remove idle sessions after 5 minutes
 * This gives users plenty of time to view results after scan completes
 */
const SESSION_CLEANUP_TIMEOUT = 5 * 60 * 1000;

/**
 * Concurrent scan batch size
 */
const CONCURRENT_BATCH_SIZE = 10;

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT = 5000;

/**
 * Maximum sessions allowed (prevent memory exhaustion)
 */
const MAX_SESSIONS = 100;

/**
 * Create or get session state
 */
function getOrCreateSession(sessionId: string): SessionScannerState {
  let session = sessions.get(sessionId);
  
  if (!session) {
    // Enforce maximum sessions
    if (sessions.size >= MAX_SESSIONS) {
      // Clean up oldest inactive session
      cleanupStaleSessions();
      
      // If still at max, reject
      if (sessions.size >= MAX_SESSIONS) {
        throw new Error("Maximum concurrent sessions reached. Please try again later.");
      }
    }
    
    session = {
      scanning: false,
      shouldStop: false,
      foundCodes: [],
      startTime: null,
      currentCode: null,
      scannedCount: 0,
      lastHeartbeat: Date.now(),
    };
    sessions.set(sessionId, session);
  }
  
  session.lastHeartbeat = Date.now();
  return session;
}

/**
 * Get session state (without creating)
 * Note: Does NOT update heartbeat - only explicit heartbeat calls do that
 */
function getSession(sessionId: string): SessionScannerState | undefined {
  return sessions.get(sessionId);
}

/**
 * Cleanup stale sessions - auto-stops scans for sessions with no heartbeat
 * Uses different timeouts for active scans vs idle sessions
 */
function cleanupStaleSessions(): void {
  const now = Date.now();
  const sessionsToRemove: string[] = [];
  const sessionsToStop: string[] = [];
  
  for (const [id, session] of sessions.entries()) {
    const timeSinceHeartbeat = now - session.lastHeartbeat;
    
    if (session.scanning) {
      // For active scans, use shorter timeout (tab close detection)
      if (timeSinceHeartbeat > SCAN_HEARTBEAT_TIMEOUT) {
        sessionsToStop.push(id);
      }
    } else {
      // For idle sessions, use longer timeout (preserve results for viewing)
      // Only remove if no results OR results are old
      if (timeSinceHeartbeat > SESSION_CLEANUP_TIMEOUT) {
        sessionsToRemove.push(id);
      }
    }
  }
  
  for (const id of sessionsToStop) {
    const session = sessions.get(id);
    if (session) {
      session.shouldStop = true;
      console.log(`[Scanner] Session ${id.substring(0, 8)}... auto-stopped: no heartbeat`);
    }
  }
  
  for (const id of sessionsToRemove) {
    const session = sessions.get(id);
    const resultCount = session?.foundCodes.length || 0;
    sessions.delete(id);
    console.log(`[Scanner] Cleaned up stale session: ${id.substring(0, 8)}... (had ${resultCount} results)`);
  }
}

// Run cleanup every 5 seconds for active scan heartbeat detection
let cleanupIntervalId: ReturnType<typeof setInterval> | null = setInterval(cleanupStaleSessions, 5 * 1000);

/**
 * Updates the heartbeat timestamp for a session
 */
export function updateHeartbeat(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastHeartbeat = Date.now();
  }
}


/**
 * Returns the list of found valid class codes for a session
 */
export function getFoundCodes(sessionId: string): ValidClassCode[] {
  const session = getSession(sessionId);
  return session ? [...session.foundCodes] : [];
}

/**
 * Clears the found codes list for a session
 */
export function clearFoundCodes(sessionId: string): void {
  const session = getSession(sessionId);
  if (session) {
    session.foundCodes = [];
  }
}

/**
 * Returns whether a scan is currently in progress for a session
 */
export function isScanning(sessionId: string): boolean {
  const session = getSession(sessionId);
  return session?.scanning ?? false;
}

/**
 * Returns scan progress for a session
 */
export function getScanProgress(sessionId: string): {
  isScanning: boolean;
  currentCode: number | null;
  scannedCount: number;
  foundCount: number;
  elapsedMs: number | null;
} {
  const session = getSession(sessionId);
  if (!session) {
    return {
      isScanning: false,
      currentCode: null,
      scannedCount: 0,
      foundCount: 0,
      elapsedMs: null,
    };
  }
  
  return {
    isScanning: session.scanning,
    currentCode: session.currentCode,
    scannedCount: session.scannedCount,
    foundCount: session.foundCodes.length,
    elapsedMs: session.startTime ? Date.now() - session.startTime : null,
  };
}

/**
 * Checks if scan has exceeded max duration
 */
function hasExceededMaxDuration(session: SessionScannerState): boolean {
  if (!session.startTime) return false;
  return Date.now() - session.startTime > MAX_SCAN_DURATION;
}

/**
 * Safely check a single class code
 */
async function checkClassCode(code: number): Promise<{
  valid: boolean;
  presenterEmail?: string;
  cpcsRegion?: string;
}> {
  try {
    const response = await axios.get<{
      presenterEmail?: string;
      cpcsRegion?: string;
    }>(API_ENDPOINTS.CLASS_CODE_LOOKUP(code), {
      timeout: REQUEST_TIMEOUT,
      validateStatus: (status) => status === 200,
    });

    if (response.data.presenterEmail && response.data.cpcsRegion) {
      return {
        valid: true,
        presenterEmail: response.data.presenterEmail,
        cpcsRegion: response.data.cpcsRegion,
      };
    }
  } catch (error) {
    // Only log unexpected errors, not 404s
    if (error instanceof AxiosError && error.response?.status !== 404) {
      console.debug(`[Scanner] Error checking code ${code}:`, error.message);
    }
  }
  
  return { valid: false };
}

/**
 * Connects to a ClassPoint session via WebSocket and collects data
 * With proper error handling and cleanup
 */
export async function connectToWebSocket(
  classCode: string,
  cpcsRegion: string,
  presenterEmail: string
): Promise<WebSocketData[]> {
  const receivedData: WebSocketData[] = [];
  let connection: ReturnType<typeof import("@microsoft/signalr").HubConnectionBuilder.prototype.build> | null = null;

  try {
    const signalR = await import("@microsoft/signalr");
    const { HubConnectionBuilder, LogLevel, HttpTransportType } = signalR;

    const url = API_ENDPOINTS.WEBSOCKET_URL(cpcsRegion);
    const username = generateUsername(DEFAULT_NAME_PREFIX);
    const participantId = generateParticipantId();

    const validateUrl = API_ENDPOINTS.VALIDATE_JOIN_URL(
      cpcsRegion,
      presenterEmail,
      classCode,
      participantId,
      username
    );

    // Validate with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      const validateResponse = await fetch(validateUrl, {
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!validateResponse.ok) {
        throw new Error(`Validation failed with status ${validateResponse.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    connection = new HubConnectionBuilder()
      .withUrl(url, {
        transport: HttpTransportType.WebSockets,
        withCredentials: true,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("SendJoinClass", (data: SendJoinClassPayload) => {
      receivedData.push({ event: "SendJoinClass", payload: data });
    });

    connection.on("SlideChanged", (data: unknown) => {
      receivedData.push({ event: "SlideChanged", payload: data as Record<string, unknown> });
    });

    connection.on("ReceiveMessage", (data: unknown) => {
      receivedData.push({ event: "ReceiveMessage", payload: data as Record<string, unknown> });
    });

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

    await delay(SCANNER_CONFIG.WEBSOCKET_COLLECT_DURATION);
  } finally {
    // Always ensure connection cleanup
    if (connection) {
      try {
        await connection.stop();
      } catch (stopError) {
        console.debug("[Scanner] Error stopping WebSocket connection:", stopError);
      }
    }
  }

  return receivedData;
}

/**
 * Process a batch of codes concurrently
 */
async function processBatch(
  codes: number[],
  session: SessionScannerState
): Promise<void> {
  const promises = codes.map(async (code) => {
    if (session.shouldStop || hasExceededMaxDuration(session)) {
      return;
    }

    session.currentCode = code;
    session.scannedCount++;

    const result = await checkClassCode(code);
    
    if (!result.valid || !result.presenterEmail || !result.cpcsRegion) {
      return;
    }

    // Check domain filter
    if (
      SCANNER_CONFIG.COLLECT_ONLY_DOMAIN &&
      !result.presenterEmail.includes(SCANNER_CONFIG.COLLECT_ONLY_DOMAIN)
    ) {
      return;
    }

    try {
      const wsData = await connectToWebSocket(
        code.toString(),
        result.cpcsRegion,
        result.presenterEmail
      );

      const isInSlideshow = wsData.some(
        (data) =>
          data.event === "SendJoinClass" &&
          (data.payload as SendJoinClassPayload)?.isInSlideshow === true
      );

      if (isInSlideshow) {
        logger.info(`Found active class: ${code} (${result.presenterEmail})`);
        session.foundCodes.push({
          code,
          email: result.presenterEmail,
          foundAt: new Date(),
        });
      }
    } catch (wsError) {
      console.debug(`[Scanner] WebSocket error for code ${code}:`, wsError);
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Starts scanning for valid class codes in the specified range for a session
 */
export async function startScanIfNotRunning(
  sessionId: string,
  start: number = SCANNER_CONFIG.START_CODE,
  end: number = SCANNER_CONFIG.END_CODE
): Promise<{ started: boolean; error?: string }> {
  const session = getOrCreateSession(sessionId);

  if (session.scanning) {
    return { started: false, error: "Scan already in progress for this session." };
  }

  // Validate range
  if (start > end) {
    return { started: false, error: "Start code must be less than or equal to end code." };
  }

  if (start < SCANNER_CONFIG.START_CODE || end > SCANNER_CONFIG.END_CODE) {
    return { 
      started: false, 
      error: `Code range must be between ${SCANNER_CONFIG.START_CODE} and ${SCANNER_CONFIG.END_CODE}.` 
    };
  }

  session.scanning = true;
  session.shouldStop = false;
  session.foundCodes = [];
  session.startTime = Date.now();
  session.scannedCount = 0;
  session.currentCode = start;

  logger.info(
    `Session ${sessionId.substring(0, 8)}... starting scan from ${start} to ${end} ` +
    `(max duration: ${MAX_SCAN_DURATION / 60000} minutes, batch size: ${CONCURRENT_BATCH_SIZE})`
  );

  // Run scan in background
  (async () => {
    try {
      const codes: number[] = [];
      for (let code = start; code <= end; code++) {
        codes.push(code);
      }

      // Process in batches for concurrency
      for (let i = 0; i < codes.length; i += CONCURRENT_BATCH_SIZE) {
        if (session.shouldStop || hasExceededMaxDuration(session)) {
          break;
        }

        const batch = codes.slice(i, i + CONCURRENT_BATCH_SIZE);
        await processBatch(batch, session);

        // Small delay between batches to prevent overwhelming the API
        await delay(100);
      }
    } catch (error) {
      logger.error(`Unexpected error in scan:`, error);
    } finally {
      session.scanning = false;
      session.startTime = null;
      session.currentCode = null;
      logger.info(
        `Session ${sessionId.substring(0, 8)}... scan completed. ` +
        `Found ${session.foundCodes.length} active classes.`
      );
    }
  })();

  return { started: true };
}

/**
 * Stops the current scan for a session
 */
export function stopScan(sessionId: string): { stopped: boolean; error?: string } {
  const session = getSession(sessionId);
  
  if (!session) {
    return { stopped: false, error: "Session not found." };
  }
  
  if (!session.scanning) {
    return { stopped: false, error: "No scan is currently running for this session." };
  }
  
  session.shouldStop = true;
  logger.info(`Session ${sessionId.substring(0, 8)}... stop signal sent.`);
  return { stopped: true };
}

/**
 * Cleanup a specific session
 */
export function cleanupSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.shouldStop = true;
    sessions.delete(sessionId);
    logger.info(`Session ${sessionId.substring(0, 8)}... cleaned up.`);
  }
}

/**
 * Get active session count (for monitoring)
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Get scanning session count (for monitoring)
 */
export function getScanningSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.scanning) count++;
  }
  return count;
}

/**
 * Dispose all scanner resources - call on shutdown
 */
export function disposeScanner(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  // Stop all active scans
  for (const session of sessions.values()) {
    session.shouldStop = true;
  }
  sessions.clear();
  logger.info('Scanner resources disposed');
}

export type { ValidClassCode };
