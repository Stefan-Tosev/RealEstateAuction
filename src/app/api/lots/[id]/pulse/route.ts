import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/*
 * What changed on a lot, in as few bytes as possible.
 *
 * §4 wants a managed channel (Ably or Pusher) so bidders learn of a bid
 * without asking. Until that account exists this is a poll, and the
 * shape is chosen so the swap is contained: the channel would carry
 * exactly this payload, and the client would react to it identically.
 *
 * The important part of §4 survives either way — "treat the channel as a
 * latency optimisation over a source of truth that lives in Postgres,
 * never as the source of truth itself". Nothing here is authoritative.
 * It tells the page *that* something moved; the page then refetches its
 * own server-rendered state, which is where eligibility, copy, formatting
 * and the reserve rules all live.
 *
 * Deliberately unauthenticated, and deliberately carrying nothing a
 * visitor cannot already read on the lot page: price, count, status and
 * the closing time. Anything viewer-dependent belongs in the refetch,
 * not here.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const lot = await prisma.lot.findUnique({
    where: { id },
    select: { status: true, effectiveCloseAt: true },
  });

  if (!lot) return new NextResponse("Not found", { status: 404 });

  const [highest, bidCount] = await Promise.all([
    prisma.bid.aggregate({ where: { lotId: id, status: "accepted" }, _max: { amountMinor: true } }),
    prisma.bid.count({ where: { lotId: id, status: "accepted" } }),
  ]);

  return NextResponse.json(
    {
      status: lot.status,
      bidCount,
      currentMinor: highest._max.amountMinor?.toString() ?? null,
      closeAtIso: lot.effectiveCloseAt?.toISOString() ?? null,
    },
    // A cached pulse is worse than no pulse: it would report a lot as
    // quiet while bids land, which is the one thing it exists to catch.
    { headers: { "cache-control": "no-store" } },
  );
}
