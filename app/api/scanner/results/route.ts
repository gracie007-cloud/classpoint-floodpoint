// app/api/scanner/results/route.ts - Get scan results for a session

import { NextResponse } from "next/server";
import { getFoundCodes, getScanProgress, updateHeartbeat } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionId = await getSessionIdFromRequest(request);
    
    // Debug log
    const progress = getScanProgress(sessionId);
    if (!progress.isScanning && Math.random() < 0.1) {
       console.log(`[API] Results poll for ${sessionId.substring(0, 8)}... - Scanning: ${progress.isScanning}, Found: ${progress.foundCount}`);
    } else if (progress.isScanning) {
       console.log(`[API] Results poll for ${sessionId.substring(0, 8)}... - Scanning: ${progress.isScanning}, Found: ${progress.foundCount}`);
    }

    // Update heartbeat to keep scan alive as long as user is polling results
    updateHeartbeat(sessionId);
    
    const results = getFoundCodes(sessionId);


    return NextResponse.json({
      results,
      isScanning: progress.isScanning,
      progress: {
        currentCode: progress.currentCode,
        scannedCount: progress.scannedCount,
        foundCount: progress.foundCount,
        elapsedMs: progress.elapsedMs,
      },
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }
    });
  } catch (error) {
    console.error("[API] Scanner results error:", error);
    return NextResponse.json(
      { results: [], isScanning: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}

