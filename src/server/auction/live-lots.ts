import type { LotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * The operations view for lots that are mid-auction — docs/open-items.md
 * §3.4.
 *
 * Sales in progress already had one. Lots did not, and they are the half
 * that moves: extension is uncapped by design (§4), so a lot scheduled to
 * close at 18:00 can still be running at 19:30, and until now nobody
 * could see which lots were in extension, how deep, or which had run so
 * far past their schedule that somebody should look.
 *
 * Read-only. Nothing here transitions a lot — that belongs to the closing
 * engine, and an operator with a button that ends an extension would
 * break the anti-snipe guarantee bidders were given.
 */

/** Only these two are mid-auction. Everything else is before or after. */
export const LIVE_STATUSES: LotStatus[] = ["BIDDING_OPEN", "EXTENDING"];

/**
 * How far past its scheduled close a lot has to be before it is worth an
 * auctioneer's attention.
 *
 * Half an hour: long enough that a lot genuinely contested at the wire
 * does not cry wolf, short enough that somebody can still be at their
 * desk for the end of it.
 */
export const RUNNING_LONG_MS = 30 * 60 * 1000;

type LiveLotRow = {
  status: LotStatus;
  extensionCount: number;
  scheduledCloseAt: Date | null;
  effectiveCloseAt: Date | null;
};

export type LiveLotSignals = {
  /** In extension right now. */
  extending: boolean;
  /** How many times bidding has pushed the close back. */
  extensionCount: number;
  /** Milliseconds the effective close sits past the scheduled one. */
  overrunMs: number;
  /** Past RUNNING_LONG_MS of overrun — the "somebody look at this" flag. */
  runningLong: boolean;
  /** Milliseconds until the effective close; negative once it is due. */
  closesInMs: number | null;
  /**
   * Due to close but still open. Means the worker has not picked it up —
   * either it is between ticks, or it is not running at all, which is the
   * failure this view exists to make visible.
   */
  overdue: boolean;
};

/**
 * Everything derived rather than stored, kept pure so it can be tested
 * without a database and without waiting for real time to pass.
 */
export function liveLotSignals(lot: LiveLotRow, now: Date): LiveLotSignals {
  /*
   * Against the *scheduled* close, not the previous effective one. The
   * question an auctioneer is asking is "how far past its advertised end
   * is this?", and each extension answers only the last one.
   */
  const overrunMs =
    lot.scheduledCloseAt && lot.effectiveCloseAt
      ? Math.max(0, lot.effectiveCloseAt.getTime() - lot.scheduledCloseAt.getTime())
      : 0;

  const closesInMs = lot.effectiveCloseAt ? lot.effectiveCloseAt.getTime() - now.getTime() : null;

  return {
    extending: lot.status === "EXTENDING",
    extensionCount: lot.extensionCount,
    overrunMs,
    runningLong: overrunMs >= RUNNING_LONG_MS,
    closesInMs,
    /*
     * A grace period rather than "closesInMs < 0": the worker runs every
     * few seconds, so a lot a moment past its close is normal and would
     * make the alert meaningless.
     */
    overdue: closesInMs !== null && closesInMs < -60_000,
  };
}

/**
 * Lots currently open for bidding, most urgent first.
 *
 * The reserve is read here, which is allowed: this module is admin-only
 * and must never be imported from src/app/(public). What crosses out of
 * it is a boolean — whether the top bid has met the reserve — not the
 * number itself.
 */
export async function listLiveLots(now: Date = new Date()) {
  const lots = await prisma.lot.findMany({
    where: { status: { in: LIVE_STATUSES } },
    select: {
      id: true,
      lotNumber: true,
      status: true,
      extensionCount: true,
      scheduledCloseAt: true,
      effectiveCloseAt: true,
      reservePriceMinor: true,
      startingPriceMinor: true,
      property: { select: { titleBg: true } },
    },
    // Whatever ends soonest is what an auctioneer needs to see first.
    orderBy: { effectiveCloseAt: "asc" },
  });

  if (lots.length === 0) return [];

  /*
   * Top accepted bid per lot in one query rather than one per lot.
   * Rejected bids are stored too (§3 — a bidder beaten by milliseconds is
   * owed a record of having tried), so they have to be excluded here or
   * the "current price" would include bids that never stood.
   */
  const tops = await prisma.bid.groupBy({
    by: ["lotId"],
    where: { lotId: { in: lots.map((lot) => lot.id) }, status: "accepted" },
    _max: { amountMinor: true },
    _count: { _all: true },
  });

  const topByLot = new Map(tops.map((row) => [row.lotId, row]));

  return lots.map((lot) => {
    const top = topByLot.get(lot.id);
    const topBidMinor = top?._max.amountMinor ?? null;

    return {
      id: lot.id,
      lotNumber: lot.lotNumber,
      title: lot.property.titleBg,
      status: lot.status,
      scheduledCloseAt: lot.scheduledCloseAt,
      effectiveCloseAt: lot.effectiveCloseAt,
      bidCount: top?._count._all ?? 0,
      topBidMinor,
      /*
       * The reserve as a yes/no. An operations list is read over
       * somebody's shoulder, and the number itself is the one thing on
       * this page that must never be said out loud.
       */
      reserveMet: topBidMinor !== null && topBidMinor >= lot.reservePriceMinor,
      ...liveLotSignals(lot, now),
    };
  });
}
