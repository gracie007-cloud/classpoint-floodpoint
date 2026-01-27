// src/lib/scanner.ts - Parallel Streaming Scanner
// Discovery and validation run SIMULTANEOUSLY for real-time results
// Results appear within 10-20 seconds, not after minutes of waiting

import type { ValidClassCode, SendJoinClassPayload } from "../types";
import { generateUsername, generateParticipantId } from "../utils";
import { SCANNER_CONFIG, API_ENDPOINTS, DEFAULT_NAME_PREFIX } from "../config";
import { scannerLogger as logger } from "../logger";
import axios from "axios";
import https from "https";

// Dedicated HTTP agent with high connection limit to avoid pool exhaustion
// Node's default global agent imposes limits that cause timeouts at high concurrency
const scannerAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 1000, // Allow 1000 concurrent sockets
  timeout: 10000,
});

// Dedicated axios instance for scanner
const scannerClient = axios.create({
  httpsAgent: scannerAgent,
  timeout: SCANNER_CONFIG.DISCOVERY_TIMEOUT,
  validateStatus: () => true, // Don't throw on 404
  headers: { accept: "application/json" }
});

// ============================================================================
// Types
// ============================================================================

interface Candidate {
  code: number;
  presenterEmail: string;
  cpcsRegion: string;
}

interface SessionScannerState {
  scanning: boolean;
  shouldStop: boolean;
  foundCodes: ValidClassCode[];
  startTime: number | null;
  currentCode: number | null;
  scannedCount: number;
  lastHeartbeat: number;
  // Resume capability
  remainingCodes: number[];
  originalRange: { start: number; end: number };
  scanMode: 'new' | 'resume' | null;
  interruptedAt: number | null;
  totalCodes: number;
  // Parallel streaming tracking
  candidateCount: number;
  validatedCount: number;
  // Candidate queue for parallel processing
  candidateQueue: Candidate[];
  validationActive: boolean;
}

// ============================================================================
// Session Management
// ============================================================================

const globalWithScanner = global as typeof globalThis & {
  _scannerSessions?: Map<string, SessionScannerState>;
};

if (!globalWithScanner._scannerSessions) {
  globalWithScanner._scannerSessions = new Map<string, SessionScannerState>();
}

const sessions = globalWithScanner._scannerSessions;

const SCAN_HEARTBEAT_TIMEOUT = 15_000;
const SESSION_CLEANUP_TIMEOUT = 5 * 60_000;
const MAX_SESSIONS = 100;

function createEmptySession(): SessionScannerState {
  return {
    scanning: false,
    shouldStop: false,
    foundCodes: [],
    startTime: null,
    currentCode: null,
    scannedCount: 0,
    lastHeartbeat: Date.now(),
    remainingCodes: [],
    originalRange: { start: SCANNER_CONFIG.START_CODE, end: SCANNER_CONFIG.END_CODE },
    scanMode: null,
    interruptedAt: null,
    totalCodes: 0,
    candidateCount: 0,
    validatedCount: 0,
    candidateQueue: [],
    validationActive: false,
  };
}

function getOrCreateSession(sessionId: string): SessionScannerState {
  let session = sessions.get(sessionId);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      cleanupStaleSessions();
      if (sessions.size >= MAX_SESSIONS) {
        throw new Error("Maximum concurrent sessions reached.");
      }
    }
    session = createEmptySession();
    sessions.set(sessionId, session);
  }
  session.lastHeartbeat = Date.now();
  return session;
}

function getSession(sessionId: string): SessionScannerState | undefined {
  return sessions.get(sessionId);
}

function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    const timeSinceHeartbeat = now - session.lastHeartbeat;
    if (session.scanning && timeSinceHeartbeat > SCAN_HEARTBEAT_TIMEOUT) {
      session.shouldStop = true;
      session.interruptedAt = Date.now();
      console.log(`[Scanner] Session ${id.substring(0, 8)}... auto-stopped: no heartbeat`);
    } else if (!session.scanning && timeSinceHeartbeat > SESSION_CLEANUP_TIMEOUT) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupStaleSessions, 5000);

// ============================================================================
// Public API
// ============================================================================

export function updateHeartbeat(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastHeartbeat = Date.now();
}

export function getFoundCodes(sessionId: string): ValidClassCode[] {
  const session = getSession(sessionId);
  return session ? [...session.foundCodes] : [];
}

export function clearFoundCodes(sessionId: string): void {
  const session = getSession(sessionId);
  if (session) {
    session.foundCodes = [];
    session.remainingCodes = [];
    session.candidateQueue = [];
    session.candidateCount = 0;
    session.validatedCount = 0;
    session.scanMode = null;
    session.interruptedAt = null;
  }
}

export function isScanning(sessionId: string): boolean {
  return getSession(sessionId)?.scanning ?? false;
}

export function getScanProgress(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) {
    return {
      isScanning: false,
      currentCode: null,
      scannedCount: 0,
      foundCount: 0,
      elapsedMs: null,
      totalCodes: 0,
      remainingCodes: 0,
      canResume: false,
      scanMode: null,
      phase: null,
      candidateCount: 0,
      validatedCount: 0,
      quickScan: false,
    };
  }

  // Determine phase based on state
  let phase: 'discovery' | 'validation' | 'complete' | null = null;
  if (session.scanning) {
    if (session.scannedCount < session.totalCodes) {
      phase = 'discovery'; // Still discovering (validation runs in parallel)
    } else if (session.validatedCount < session.candidateCount) {
      phase = 'validation'; // Discovery done, finishing validation
    }
  } else if (session.remainingCodes.length === 0 && session.foundCodes.length > 0) {
    phase = 'complete';
  }

  return {
    isScanning: session.scanning,
    currentCode: session.currentCode,
    scannedCount: session.scannedCount,
    foundCount: session.foundCodes.length,
    elapsedMs: session.startTime ? Date.now() - session.startTime : null,
    totalCodes: session.totalCodes,
    remainingCodes: session.remainingCodes.length,
    canResume: !session.scanning && session.remainingCodes.length > 0,
    scanMode: session.scanMode,
    phase,
    candidateCount: session.candidateCount,
    validatedCount: session.validatedCount,
    quickScan: false,
  };
}

export function stopScan(sessionId: string): { stopped: boolean; error?: string } {
  const session = getSession(sessionId);
  if (!session) return { stopped: false, error: "Session not found." };
  if (!session.scanning) return { stopped: false, error: "No scan running." };
  
  session.shouldStop = true;
  session.interruptedAt = Date.now();
  logger.info(`Session ${sessionId.substring(0, 8)}... stop signal sent.`);
  return { stopped: true };
}

export function cleanupSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.shouldStop = true;
    sessions.delete(sessionId);
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function getScanningSessionCount(): number {
  let count = 0;
  for (const s of sessions.values()) if (s.scanning) count++;
  return count;
}

export function disposeScanner(): void {
  for (const session of sessions.values()) session.shouldStop = true;
  sessions.clear();
}

// ============================================================================
// Worker Pool - Optimized for high throughput
// ============================================================================

class WorkerPool<T> {
  private queue: T[] = [];
  private activeCount = 0;
  private readonly concurrency: number;
  private readonly processor: (item: T) => Promise<void>;
  private drainResolver: (() => void) | null = null;
  private stopped = false;

  constructor(concurrency: number, processor: (item: T) => Promise<void>) {
    this.concurrency = concurrency;
    this.processor = processor;
  }

  push(item: T): void {
    if (this.stopped) return;
    this.queue.push(item);
    this.tryProcess();
  }

  pushMany(items: T[]): void {
    if (this.stopped) return;
    this.queue.push(...items);
    // Start multiple workers immediately
    for (let i = 0; i < Math.min(items.length, this.concurrency); i++) {
      this.tryProcess();
    }
  }

  private async tryProcess(): Promise<void> {
    if (this.stopped || this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    try {
      await this.processor(item);
    } catch {
      // Errors handled in processor
    } finally {
      this.activeCount--;
      // Immediately try next
      this.tryProcess();
      // Check if drained
      if (this.activeCount === 0 && this.queue.length === 0 && this.drainResolver) {
        this.drainResolver();
        this.drainResolver = null;
      }
    }
  }

  async drain(): Promise<void> {
    if (this.activeCount === 0 && this.queue.length === 0) return;
    return new Promise(resolve => { this.drainResolver = resolve; });
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.activeCount;
  }
}

// ============================================================================
// Discovery - Fast API checking
// ============================================================================

// Diagnostic counters for debugging
let discoveryStats = {
  total: 0,
  ok: 0,
  notFound: 0,
  otherStatus: 0,
  timeout: 0,
  networkError: 0,
  invalidData: 0,
  lastLogTime: Date.now(),
};

function logDiscoveryStats() {
  const now = Date.now();
  if (now - discoveryStats.lastLogTime > 5000) { // Log every 5 seconds
    // Use warn level to ensure it shows in production
    logger.warn(`[Discovery Stats] Total: ${discoveryStats.total}, OK: ${discoveryStats.ok}, 404: ${discoveryStats.notFound}, Other: ${discoveryStats.otherStatus}, Timeout: ${discoveryStats.timeout}, NetErr: ${discoveryStats.networkError}, Invalid: ${discoveryStats.invalidData}`);
    discoveryStats.lastLogTime = now;
  }
}

async function checkCode(code: number): Promise<Candidate | null> {
  // Use abort controller for timeout management with Axios
  const controller = new AbortController();
  // Add a buffer to the timeout to allow axios to timeout first
  const timeoutId = setTimeout(() => controller.abort(), SCANNER_CONFIG.DISCOVERY_TIMEOUT + 500);

  discoveryStats.total++;

  try {
    const response = await scannerClient.get(API_ENDPOINTS.CLASS_CODE_LOOKUP(code), {
      signal: controller.signal
    });

    if (response.status !== 200) {
      if (response.status === 404) {
        discoveryStats.notFound++;
      } else {
        discoveryStats.otherStatus++;
        // Log unusual status codes
        if (discoveryStats.otherStatus <= 10) {
          logger.warn(`[Discovery] Code ${code} returned status ${response.status}`);
        }
      }
      logDiscoveryStats();
      return null;
    }

    discoveryStats.ok++;
    const data = response.data;
    if (data.presenterEmail && data.cpcsRegion) {
      logDiscoveryStats();
      return { code, presenterEmail: data.presenterEmail, cpcsRegion: data.cpcsRegion };
    }
    discoveryStats.invalidData++;
    logDiscoveryStats();
  } catch (error) {
    if (axios.isCancel(error) || (error instanceof Error && error.name === "AbortError") || (axios.isAxiosError(error) && error.code === 'ECONNABORTED')) {
      discoveryStats.timeout++;
    } else {
      discoveryStats.networkError++;
      // Log first few network errors
      if (discoveryStats.networkError <= 5) {
        logger.warn(`[Discovery] Network error for code ${code}:`, error);
      }
    }
    logDiscoveryStats();
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

// Export for debugging
export function getDiscoveryStats() {
  return { ...discoveryStats };
}

export function resetDiscoveryStats() {
  discoveryStats = {
    total: 0,
    ok: 0,
    notFound: 0,
    otherStatus: 0,
    timeout: 0,
    networkError: 0,
    invalidData: 0,
    lastLogTime: Date.now(),
  };
}

// ============================================================================
// Validation - WebSocket with early exit
// ============================================================================

async function validateCandidate(candidate: Candidate): Promise<boolean> {
  const { HubConnectionBuilder, LogLevel, HttpTransportType } = await import("@microsoft/signalr");
  
  const url = API_ENDPOINTS.WEBSOCKET_URL(candidate.cpcsRegion);
  const username = generateUsername(DEFAULT_NAME_PREFIX);
  const participantId = generateParticipantId();

  // Quick pre-validation
  const validateUrl = API_ENDPOINTS.VALIDATE_JOIN_URL(
    candidate.cpcsRegion,
    candidate.presenterEmail,
    candidate.code.toString(),
    participantId,
    username
  );

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), SCANNER_CONFIG.DISCOVERY_TIMEOUT);
    
    const validateResponse = await fetch(validateUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    
    if (!validateResponse.ok) return false;
  } catch {
    return false;
  }

  // WebSocket validation with early exit
  let connection: ReturnType<typeof HubConnectionBuilder.prototype.build> | null = null;
  
  try {
    connection = new HubConnectionBuilder()
      .withUrl(url, { transport: HttpTransportType.WebSockets, withCredentials: true })
      .configureLogging(LogLevel.None)  // Silence for performance
      .build();

    let isInSlideshow = false;
    let resolved = false;

    const resultPromise = new Promise<boolean>((resolve) => {
      // Early exit: resolve as soon as we get the event
      connection!.on("SendJoinClass", (data: SendJoinClassPayload) => {
        if (!resolved) {
          resolved = true;
          isInSlideshow = data?.isInSlideshow === true;
          resolve(isInSlideshow);
        }
      });

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, SCANNER_CONFIG.VALIDATION_TIMEOUT);
    });

    await connection.start();
    await connection.send("Send", { protocol: "json", version: 1 });
    await connection.send("ParticipantStartup", {
      participantUsername: username,
      participantName: username,
      participantId,
      participantAvatar: "",
      cpcsRegion: candidate.cpcsRegion,
      presenterEmail: candidate.presenterEmail,
      classSessionId: "",
    });

    return await resultPromise;
  } catch {
    return false;
  } finally {
    if (connection) {
      try { await connection.stop(); } catch { /* ignore */ }
    }
  }
}

// ============================================================================
// Utility
// ============================================================================

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// ============================================================================
// Main Scanner - Parallel Streaming
// ============================================================================

export async function startScanIfNotRunning(
  sessionId: string,
  start: number = SCANNER_CONFIG.START_CODE,
  end: number = SCANNER_CONFIG.END_CODE,
  options: { resume?: boolean } = {}
): Promise<{ started: boolean; error?: string }> {
  const session = getOrCreateSession(sessionId);

  if (session.scanning) {
    return { started: false, error: "Scan already in progress." };
  }

  if (start > end || start < SCANNER_CONFIG.START_CODE || end > SCANNER_CONFIG.END_CODE) {
    return { started: false, error: "Invalid code range." };
  }

  let codesToScan: number[];

  if (options.resume && session.remainingCodes.length > 0) {
    codesToScan = session.remainingCodes;
    session.scanMode = 'resume';
    logger.info(`Session ${sessionId.substring(0, 8)}... resuming with ${codesToScan.length} codes`);
  } else {
    const allCodes: number[] = [];
    for (let code = start; code <= end; code++) allCodes.push(code);
    codesToScan = shuffleArray(allCodes);
    session.foundCodes = [];
    session.candidateQueue = [];
    session.candidateCount = 0;
    session.validatedCount = 0;
    session.scanMode = 'new';
    session.originalRange = { start, end };
    session.totalCodes = allCodes.length;
    logger.info(
      `Session ${sessionId.substring(0, 8)}... starting parallel scan ` +
      `(${codesToScan.length} codes, discovery: ${SCANNER_CONFIG.DISCOVERY_CONCURRENCY}, ` +
      `validation: ${SCANNER_CONFIG.VALIDATION_CONCURRENCY})`
    );
  }

  session.scanning = true;
  session.shouldStop = false;
  session.startTime = Date.now();
  session.scannedCount = session.scanMode === 'resume' ? session.totalCodes - codesToScan.length : 0;
  session.currentCode = codesToScan[0] || null;
  session.remainingCodes = [...codesToScan];
  session.interruptedAt = null;

  // Run scan in background with parallel pools
  (async () => {
    try {
      // Validation pool - processes candidates as they arrive
      const validationPool = new WorkerPool<Candidate>(
        SCANNER_CONFIG.VALIDATION_CONCURRENCY,
        async (candidate) => {
          if (session.shouldStop) return;
          
          const isValid = await validateCandidate(candidate);
          session.validatedCount++;
          
          if (isValid) {
            session.foundCodes.push({
              code: candidate.code,
              email: candidate.presenterEmail,
              foundAt: new Date(),
            });
            logger.info(`✓ Confirmed: ${candidate.code} (${candidate.presenterEmail})`);
          }
        }
      );

      // Discovery pool - finds candidates and feeds validation pool
      const discoveryPool = new WorkerPool<number>(
        SCANNER_CONFIG.DISCOVERY_CONCURRENCY,
        async (code) => {
          if (session.shouldStop) return;
          
          session.currentCode = code;
          session.scannedCount++;
          
          // Update remaining codes for resume
          const idx = session.remainingCodes.indexOf(code);
          if (idx > -1) session.remainingCodes.splice(idx, 1);
          
          const candidate = await checkCode(code);
          
          if (candidate) {
            // Check domain filter
            if (SCANNER_CONFIG.COLLECT_ONLY_DOMAIN && 
                !candidate.presenterEmail.includes(SCANNER_CONFIG.COLLECT_ONLY_DOMAIN)) {
              return;
            }
            
            session.candidateCount++;
            // Immediately queue for validation (parallel processing)
            validationPool.push(candidate);
          }
        }
      );

      // Feed all codes to discovery pool
      discoveryPool.pushMany(codesToScan);

      // Wait for discovery to complete
      await discoveryPool.drain();
      
      // Wait for remaining validations
      await validationPool.drain();

      // Mark remaining codes as empty if completed successfully
      if (!session.shouldStop) {
        session.remainingCodes = [];
      }

    } catch (error) {
      logger.error(`Scan error:`, error);
      session.interruptedAt = Date.now();
    } finally {
      session.scanning = false;
      session.startTime = null;
      session.currentCode = null;
      
      const completed = session.remainingCodes.length === 0;
      logger.info(
        `Session ${sessionId.substring(0, 8)}... scan ${completed ? 'completed' : 'stopped'}. ` +
        `Found ${session.foundCodes.length} active (from ${session.candidateCount} candidates).`
      );
    }
  })();

  return { started: true };
}

export type { ValidClassCode };
