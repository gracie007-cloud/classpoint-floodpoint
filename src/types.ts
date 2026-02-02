// src/types.ts - Centralized type definitions

import type * as signalR from "@microsoft/signalr";

/**
 * Represents a single bot connection to a ClassPoint session
 */
export interface ConnectionInfo {
  id: number;
  username: string;
  participantId: string;
  connection: signalR.HubConnection;
  status: ConnectionStatus;
}

/**
 * Possible statuses for a connection
 */
export type ConnectionStatus = "Connected" | "Connecting" | "Disconnected" | "Error";

/**
 * Response from the ClassPoint class code API
 */
export interface ClassCodeResponse {
  cpcsRegion: string;
  presenterEmail: string;
  classCode?: string;
}

/**
 * Represents a validated class code from scanning
 */
export interface ValidClassCode {
  code: number;
  email: string;
  foundAt: Date;
}

/**
 * Payload for SendJoinClass event
 */
export interface SendJoinClassPayload {
  isInSlideshow: boolean;
  presenterName?: string;
  className?: string;
}

/**
 * Payload for SlideChanged event
 */
export interface SlideChangedPayload {
  slideNumber?: number;
  slideId?: string;
}

/**
 * WebSocket data received during scanning (discriminated union for type safety)
 */
export type WebSocketData =
  | { event: "SendJoinClass"; payload: SendJoinClassPayload }
  | { event: "SlideChanged"; payload: SlideChangedPayload }
  | { event: "ReceiveMessage"; payload: Record<string, unknown> }
  | { event: string; payload: Record<string, unknown> };

/**
 * Known WebSocket event types
 */
export type WebSocketEventType = "SendJoinClass" | "SlideChanged" | "ReceiveMessage" | string;

/**
 * Configuration for the flooder
 */
export interface FlooderConfig {
  classCode: string;
  numConnections: number;
  namePrefix: string;
}

/**
 * Saved participant from ClassPoint API
 */
export interface SavedParticipant {
  participantUsername: string;
  participantName: string;
  participantAvatar: string | null;
}

/**
 * Flooder mode
 */
export type FlooderMode = 'guest' | 'restricted';

/**
 * Configuration for the scanner
 */
export interface ScannerConfig {
  startCode: number;
  endCode: number;
  collectOnlyDomain?: string;
}

/**
 * Scan progress information - extended with two-phase data
 */
export interface ScanProgress {
  currentCode: number | null;
  scannedCount: number;
  foundCount: number;
  elapsedMs: number | null;
  /** Total codes in the scan range */
  totalCodes: number;
  /** Number of codes remaining to scan */
  remainingCodes: number;
  /** Whether the scan can be resumed */
  canResume: boolean;
  /** Current scan mode */
  scanMode: 'new' | 'resume' | null;
  /** Current scanning phase */
  phase: 'discovery' | 'validation' | 'complete' | null;
  /** Number of candidates found in Phase 1 (discovery) */
  candidateCount: number;
  /** Number of candidates validated in Phase 2 */
  validatedCount: number;
  /** Whether this is a quick scan (no WebSocket validation) */
  quickScan: boolean;
}

/**
 * API response for scan operations
 */
export interface ScanResponse {
  started?: boolean;
  stopped?: boolean;
  message: string;
}

/**
 * API response for scan results
 */
export interface ScanResultsResponse {
  results: ValidClassCode[];
  isScanning: boolean;
  progress?: ScanProgress;
  message?: string;
}

/**
 * Progress tracking for the flooder with adaptive rate limiting
 */
export interface FlooderProgress {
  /** Total connections requested by user */
  totalRequested: number;
  /** Successfully connected bots */
  connected: number;
  /** Currently attempting to connect */
  connecting: number;
  /** Failed connections (exhausted retries) */
  failed: number;
  /** Connections waiting for retry */
  retrying: number;
  /** Current wave number */
  waveNumber: number;
  /** Current dynamic concurrency level */
  currentConcurrency: number;
  /** Recent success rate (0-1) */
  successRate: number;
  /** Whether rate limiting is detected */
  isThrottled: boolean;
  /** Estimated time remaining in ms, null if unknown */
  estimatedTimeRemaining: number | null;

  // Enhanced visibility fields
  /** Whether currently waiting for retry window */
  waitingForRetry?: boolean;
  /** Milliseconds until next retry attempt */
  nextRetryIn?: number | null;
  /** Current system status for display */
  statusMessage?: string;
  /** Average latency of recent connections (ms) */
  averageLatency?: number;
  /** Whether in cooldown period */
  inCooldown?: boolean;
  /** Cooldown remaining (ms) */
  cooldownRemaining?: number;
  /** Breakdown of retry errors by type */
  retryErrorCounts?: Record<string, number>;
}

/**
 * Retry state for a failed connection
 */
export interface RetryState {
  /** Connection ID */
  id: number;
  /** Number of retry attempts made */
  retries: number;
  /** Timestamp when next retry is allowed */
  nextRetryAt: number;
}
