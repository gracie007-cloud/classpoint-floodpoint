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
 * Configuration for the scanner
 */
export interface ScannerConfig {
  startCode: number;
  endCode: number;
  collectOnlyDomain?: string;
}

/**
 * Scan progress information
 */
export interface ScanProgress {
  currentCode: number | null;
  scannedCount: number;
  foundCount: number;
  elapsedMs: number | null;
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

