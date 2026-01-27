// app/api/health/route.ts - Health check endpoint for monitoring

import { NextResponse } from "next/server";
import { VERSION } from "@/src/config";
import { generalRateLimiter, getClientId, rateLimitResponse, createRateLimitHeaders } from "@/src/lib/rate-limit";

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  timestamp: string;
}

export async function GET(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = generalRateLimiter.check(clientId);

    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    // Return minimal health info - no internal metrics exposed publicly
    const response: HealthResponse = {
      status: "healthy",
      version: VERSION,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
    });
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

