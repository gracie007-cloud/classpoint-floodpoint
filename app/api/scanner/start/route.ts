// app/api/scanner/start/route.ts - Start a class code scan with session isolation and rate limiting

import { NextResponse } from "next/server";
import { startScanIfNotRunning, isScanning, getScanProgress } from "@/src/lib/scanner";
import { SCANNER_CONFIG } from "@/src/config";
import { getSessionIdFromRequest } from "@/src/lib/session";
import { scannerRateLimiter, getClientId, rateLimitResponse } from "@/src/lib/rate-limit";

interface StartScanRequest {
  start?: number;
  end?: number;
  resume?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = scannerRateLimiter.check(clientId);
    
    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    // Get session ID
    const sessionId = await getSessionIdFromRequest(request);

    // Check if already scanning
    if (isScanning(sessionId)) {
      const progress = getScanProgress(sessionId);
      return NextResponse.json(
        {
          started: false,
          message: "A scan is already in progress for this session.",
          progress,
        },
        { status: 409 }
      );
    }

    // Parse request body
    let body: StartScanRequest = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine, use defaults
    }

    // Validate and clamp range
    const start =
      typeof body.start === "number" &&
      body.start >= SCANNER_CONFIG.START_CODE &&
      body.start <= SCANNER_CONFIG.END_CODE
        ? Math.floor(body.start)
        : SCANNER_CONFIG.START_CODE;

    const end =
      typeof body.end === "number" &&
      body.end >= SCANNER_CONFIG.START_CODE &&
      body.end <= SCANNER_CONFIG.END_CODE
        ? Math.floor(body.end)
        : SCANNER_CONFIG.END_CODE;

    // Validate start <= end
    if (start > end) {
      return NextResponse.json(
        {
          started: false,
          message: "Start code must be less than or equal to end code.",
        },
        { status: 400 }
      );
    }

    // Start scanning (returns immediately, scan runs in background)
    const result = await startScanIfNotRunning(sessionId, start, end, {
      resume: body.resume === true,
    });

    if (!result.started) {
      return NextResponse.json(
        { started: false, message: result.error || "Failed to start scan." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      started: true,
      message: `Scan initiated for codes ${start} to ${end}.`,
      range: { start, end },
      totalCodes: end - start + 1,
    });
  } catch (error) {
    console.error("[API] Scanner start error:", error);
    return NextResponse.json(
      { started: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}
