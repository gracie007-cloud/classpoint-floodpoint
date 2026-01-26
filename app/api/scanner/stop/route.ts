// app/api/scanner/stop/route.ts - Stop the current scan for a session

import { NextResponse } from "next/server";
import { stopScan, isScanning, getScanProgress } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionId = await getSessionIdFromRequest(request);

    if (!isScanning(sessionId)) {
      return NextResponse.json(
        { stopped: false, message: "No scan is currently running for this session." },
        { status: 400 }
      );
    }

    const result = stopScan(sessionId);

    if (!result.stopped) {
      return NextResponse.json(
        { stopped: false, message: result.error || "Failed to stop scan." },
        { status: 400 }
      );
    }

    // Include final progress
    const progress = getScanProgress(sessionId);

    return NextResponse.json({
      stopped: true,
      message: "Scan stop signal sent.",
      progress,
    });
  } catch (error) {
    console.error("[API] Scanner stop error:", error);
    return NextResponse.json(
      { stopped: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}
