// app/api/scanner/results/route.ts - Get scan results for a session

import { NextResponse } from "next/server";
import { getFoundCodes, getScanProgress, updateHeartbeat } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";
import { generalRateLimiter, getClientId, rateLimitResponse, createRateLimitHeaders } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = generalRateLimiter.check(clientId);

    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    const sessionId = await getSessionIdFromRequest(request);

    // Update heartbeat to keep scan alive as long as user is polling results
    updateHeartbeat(sessionId);
    
    const results = getFoundCodes(sessionId);
    const progress = getScanProgress(sessionId);

    return NextResponse.json({
      results,
      isScanning: progress.isScanning,
      progress: {
        currentCode: progress.currentCode,
        scannedCount: progress.scannedCount,
        foundCount: progress.foundCount,
        elapsedMs: progress.elapsedMs,
        totalCodes: progress.totalCodes,
        remainingCodes: progress.remainingCodes,
        canResume: progress.canResume,
        scanMode: progress.scanMode,
        phase: progress.phase,
        candidateCount: progress.candidateCount,
        validatedCount: progress.validatedCount,
        quickScan: progress.quickScan,
      },
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        ...createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 100),
      }
    });
  } catch (error) {
    console.error("[API] Scanner results error:", error);
    return NextResponse.json(
      { results: [], isScanning: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}


