// app/api/scanner/stop/route.ts - Stop the current scan for a session

import { NextResponse } from "next/server";
import { stopScan, isScanning, getScanProgress } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";
import { generalRateLimiter, getClientId, rateLimitResponse, createRateLimitHeaders } from "@/src/lib/rate-limit";

export async function POST(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = generalRateLimiter.check(clientId);

    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    const sessionId = await getSessionIdFromRequest(request);

    if (!isScanning(sessionId)) {
      return NextResponse.json(
        { error: "No scan is currently running for this session." },
        { 
          status: 400,
          headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
        }
      );
    }

    const result = stopScan(sessionId);

    if (!result.stopped) {
      return NextResponse.json(
        { error: result.error || "Failed to stop scan." },
        { 
          status: 400,
          headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
        }
      );
    }

    // Include final progress
    const progress = getScanProgress(sessionId);

    return NextResponse.json({
      stopped: true,
      message: "Scan stop signal sent.",
      progress,
    }, {
      headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
    });
  } catch (error) {
    console.error("[API] Scanner stop error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

