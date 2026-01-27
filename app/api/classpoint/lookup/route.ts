// app/api/classpoint/lookup/route.ts - Look up class code information with rate limiting

import { NextResponse } from "next/server";
import { lookupClassCode } from "@/src/lib/classpoint";
import { lookupRateLimiter, getClientId, rateLimitResponse, createRateLimitHeaders } from "@/src/lib/rate-limit";
import { validateClassCode } from "@/src/config";

export async function GET(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = lookupRateLimiter.check(clientId);

    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    const { searchParams } = new URL(request.url);
    const classCode = searchParams.get("code");

    // Use centralized validation
    const validation = validateClassCode(classCode || "");
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid class code" },
        { status: 400, headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60) }
      );
    }

    // Safe extraction after validation
    const validatedCode = classCode!.trim();

    const classInfo = await lookupClassCode(validatedCode);

    if (!classInfo) {
      return NextResponse.json(
        { error: "Class not found or invalid code" },
        { status: 404, headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60) }
      );
    }

    // Return with Cache-Control headers to prevent stale session info
    return NextResponse.json(classInfo, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        ...createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60),
      }
    });
  } catch (error) {
    console.error("[API] ClassPoint lookup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
