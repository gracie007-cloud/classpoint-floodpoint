// app/api/scanner/clear/route.ts - Clear scan results and resume state for a session

import { NextResponse } from "next/server";
import { clearFoundCodes, isScanning } from "@/src/lib/scanner";
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

    // Don't clear if actively scanning
    if (isScanning(sessionId)) {
      return NextResponse.json(
        { error: "Cannot clear while scan is in progress." },
        { 
          status: 400,
          headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
        }
      );
    }

    clearFoundCodes(sessionId);

    return NextResponse.json({
      cleared: true,
      message: "Results and resume state cleared.",
    }, {
      headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
    });
  } catch (error) {
    console.error("[API] Scanner clear error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

