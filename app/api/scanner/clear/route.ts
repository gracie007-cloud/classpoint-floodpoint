// app/api/scanner/clear/route.ts - Clear scan results and resume state for a session

import { NextResponse } from "next/server";
import { clearFoundCodes, isScanning } from "@/src/lib/scanner";
import { getSessionIdFromRequest } from "@/src/lib/session";

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionId = await getSessionIdFromRequest(request);

    // Don't clear if actively scanning
    if (isScanning(sessionId)) {
      return NextResponse.json(
        { cleared: false, message: "Cannot clear while scan is in progress." },
        { status: 400 }
      );
    }

    clearFoundCodes(sessionId);

    return NextResponse.json({
      cleared: true,
      message: "Results and resume state cleared.",
    });
  } catch (error) {
    console.error("[API] Scanner clear error:", error);
    return NextResponse.json(
      { cleared: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}
