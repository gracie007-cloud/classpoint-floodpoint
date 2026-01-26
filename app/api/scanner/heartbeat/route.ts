// app/api/scanner/heartbeat/route.ts - Heartbeat endpoint for tab close detection

import { NextResponse } from "next/server";
import { getScanProgress, updateHeartbeat } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionId = await getSessionIdFromRequest(request);
    
    // Update heartbeat timestamp
    updateHeartbeat(sessionId);
    
    // Return current progress
    const progress = getScanProgress(sessionId);

    return NextResponse.json({
      success: true,
      ...progress,
    });
  } catch (error) {
    console.error("[API] Heartbeat error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
