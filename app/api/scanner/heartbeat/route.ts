// app/api/scanner/heartbeat/route.ts - Heartbeat endpoint for tab close detection

import { NextResponse } from "next/server";
import { getScanProgress, updateHeartbeat } from "@/src/lib/scanner";
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
    
    // Update heartbeat timestamp
    updateHeartbeat(sessionId);
    
    // Return current progress
    const progress = getScanProgress(sessionId);

    return NextResponse.json({
      success: true,
      ...progress,
    }, {
      headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
    });
  } catch (error) {
    console.error("[API] Heartbeat error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

