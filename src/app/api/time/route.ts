import { NextResponse } from "next/server";

/*
 * Authoritative clock for countdowns.
 *
 * docs/architecture.md §3 invariant 5: "The bidder's countdown is derived
 * from server time offset, never the device clock. Phones drift by
 * minutes." v1 used Date.now() directly and so could show a bidder a
 * countdown minutes out from the auction's own.
 *
 * Why a separate endpoint rather than embedding the timestamp in the page
 * HTML: the moment page output is cached anywhere — ISR, a CDN, the
 * browser's back/forward cache — an embedded timestamp is stale by the
 * cache age, and the resulting offset is wrong by exactly that much. A
 * no-store endpoint cannot be cached into that bug.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
