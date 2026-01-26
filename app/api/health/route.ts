// app/api/health/route.ts - Health check endpoint for monitoring

import { NextResponse } from "next/server";
import { getActiveSessionCount, getScanningSessionCount } from "@/src/lib/scanner";
import { VERSION } from "@/src/config";

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  timestamp: string;
  uptime: number;
  metrics: {
    activeSessions: number;
    scanningSessions: number;
  };
}

// Track server start time
const startTime = Date.now();

export async function GET(): Promise<Response> {
  try {
    const activeSessions = getActiveSessionCount();
    const scanningSessions = getScanningSessionCount();

    const response: HealthResponse = {
      status: "healthy",
      version: VERSION,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime,
      metrics: {
        activeSessions,
        scanningSessions,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[API] Health check error:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        version: VERSION,
        timestamp: new Date().toISOString(),
        error: "Health check failed",
      },
      { status: 503 }
    );
  }
}
