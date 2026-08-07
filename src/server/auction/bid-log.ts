import { prisma } from "@/lib/prisma";

/*
 * The bid log a seller gets after their lot closes.
 *
 * This is the second half of the access design already written into
 * place-bid.ts: "a seller sees the same public price everyone does,
 * never bidder identities, and gets a full anonymised bid log after
 * close." The first half has been enforced since Phase 3; this is the
 * part that was still owed.
 *
 * Why a seller should have it at all: they are being asked to accept a
 * price set by a process they could not watch. A list of what was bid
 * and when is the evidence that the price was genuinely contested — and
 * it is what makes the auctioneer's "this is what the market said"
 * checkable rather than a claim.
 *
 * Why it is anonymised: knowing WHO bid lets a seller approach the
 * underbidder directly and complete off-platform, which costs the house
 * its commission and the buyer their protections. Bidder numbering gives
 * the seller everything they need to judge the sale and nothing they
 * could use to go around it.
 */

export type BidLogEntry = {
  /** 1-based, in the order bidders first appear. Stable within a lot. */
  bidderIndex: number;
  amountMinor: bigint;
  at: Date;
  /** Whether this bid moved the clock — visible proof the soft close worked. */
  extendedClock: boolean;
};

export type BidLog = {
  lotId: string;
  lotRef: string;
  /** How many distinct people bid. The number a seller actually cares about. */
  bidderCount: number;
  entries: BidLogEntry[];
};

/**
 * Accepted bids only.
 *
 * Rejected attempts are kept for audit (§3) but have no place here: a
 * bid that was too low or arrived after the close says nothing about
 * what the property was worth, and listing them invites a seller to
 * argue that a refused bid should have counted.
 */
export async function bidLogForLot(lotId: string): Promise<BidLog> {
  const lot = await prisma.lot.findUniqueOrThrow({
    where: { id: lotId },
    select: { lotNumber: true },
  });

  const bids = await prisma.bid.findMany({
    where: { lotId, status: "accepted" },
    orderBy: { receivedAt: "asc" },
    select: { userId: true, amountMinor: true, receivedAt: true, causedExtensionTo: true },
  });

  /*
   * Numbered in first-appearance order, exactly as the public panel does
   * it — so a seller comparing the log against what the page showed
   * during the auction sees the same participants under the same labels.
   */
  const order: string[] = [];
  for (const bid of bids) {
    if (!order.includes(bid.userId)) order.push(bid.userId);
  }

  return {
    lotId,
    lotRef: String(lot.lotNumber).padStart(3, "0"),
    bidderCount: order.length,
    entries: bids.map((bid) => ({
      bidderIndex: order.indexOf(bid.userId) + 1,
      amountMinor: bid.amountMinor,
      at: bid.receivedAt,
      extendedClock: bid.causedExtensionTo !== null,
    })),
  };
}
