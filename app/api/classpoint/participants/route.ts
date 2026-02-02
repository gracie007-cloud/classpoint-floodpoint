// app/api/classpoint/participants/route.ts - Fetch saved participants for restricted mode

import { NextResponse } from "next/server";
import { lookupRateLimiter, getClientId, rateLimitResponse, createRateLimitHeaders } from "@/src/lib/rate-limit";
import { API_ENDPOINTS } from "@/src/config";
import type { SavedParticipant } from "@/src/types";

export async function GET(request: Request): Promise<Response> {
  try {
    // Rate limiting check
    const clientId = getClientId(request);
    const rateCheck = lookupRateLimiter.check(clientId);

    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.resetIn);
    }

    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region");
    const email = searchParams.get("email");

    if (!region || !email) {
      return NextResponse.json(
        { error: "Region and email are required" },
        { status: 400, headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60) }
      );
    }

    // Fetch saved participants from ClassPoint API
    const url = API_ENDPOINTS.SAVED_PARTICIPANTS_URL(region, email);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.classpoint.app',
        'Referer': 'https://www.classpoint.app/',
      }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch participants" },
        { status: response.status, headers: createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60) }
      );
    }

    const participants: SavedParticipant[] = await response.json();

    // Return with Cache-Control headers to prevent stale data
    return NextResponse.json(participants, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        ...createRateLimitHeaders(rateCheck.remaining, rateCheck.resetIn, 60),
      }
    });
  } catch (error) {
    console.error("[API] Participants lookup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
