import { prisma } from "@/lib/prisma";
import { minimumNextBid } from "./increments";

/*
 * What the lot page needs to render the bid panel.
 *
 * Eligibility is reported as a reason rather than a boolean, because
 * "you cannot bid" is useless to someone who could bid if they did one
 * more thing. Each state maps to a different next step.
 *
 * The reserve is never part of this — invariant 7. Nothing here reads it.
 */

export type BidEligibility =
  | { canBid: true }
  | { canBid: false; reason: "not-signed-in" | "not-approved" | "no-deposit" | "not-open" };

export type BiddingView = {
  status: string;
  /** Highest accepted bid, or null before the first one. */
  currentMinor: string | null;
  /** The lowest amount that would be accepted next — a FLOOR, not a step. */
  minimumMinor: string;
  bidCount: number;
  eligibility: BidEligibility;
  /**
   * Anonymised, most recent first. Identities are never public.
   *
   * The index is 1-based and stable within a lot; the *label* is the
   * page's job, because this is user-facing copy and the site is
   * Bulgarian by default.
   */
  recentBids: { bidderIndex: number; amountMinor: string; atIso: string; extended: boolean }[];
};

export async function getBiddingView(
  lotId: string,
  viewerId: string | null,
): Promise<BiddingView> {
  const lot = await prisma.lot.findUniqueOrThrow({
    where: { id: lotId },
    select: {
      status: true,
      startingPriceMinor: true,
      depositRequiredMinor: true,
    },
  });

  const [highest, bidCount, accepted] = await Promise.all([
    prisma.bid.aggregate({
      where: { lotId, status: "accepted" },
      _max: { amountMinor: true },
    }),
    prisma.bid.count({ where: { lotId, status: "accepted" } }),
    prisma.bid.findMany({
      where: { lotId, status: "accepted" },
      orderBy: { receivedAt: "desc" },
      take: 10,
      select: { userId: true, amountMinor: true, receivedAt: true, causedExtensionTo: true },
    }),
  ]);

  const currentMinor = highest._max.amountMinor ?? null;
  const minimum = await minimumNextBid(prisma, currentMinor, lot.startingPriceMinor);

  /*
   * Stable per-lot numbering, in the order bidders first appear. Bidder
   * identities are never public — a seller or rival who can tell who is
   * bidding can approach them directly, and that is the disclosure that
   * actually causes harm. The numbers still let anyone verify the shape
   * of the bidding: how many people, and who is bidding against whom.
   */
  const order: string[] = [];
  for (const bid of [...accepted].reverse()) {
    if (!order.includes(bid.userId)) order.push(bid.userId);
  }

  return {
    status: lot.status,
    currentMinor: currentMinor?.toString() ?? null,
    minimumMinor: minimum.toString(),
    bidCount,
    eligibility: await eligibilityFor(lotId, lot.status, lot.depositRequiredMinor, viewerId),
    recentBids: accepted.map((bid) => ({
      bidderIndex: order.indexOf(bid.userId) + 1,
      amountMinor: bid.amountMinor.toString(),
      atIso: bid.receivedAt.toISOString(),
      extended: bid.causedExtensionTo !== null,
    })),
  };
}

async function eligibilityFor(
  lotId: string,
  status: string,
  depositRequiredMinor: bigint | null,
  viewerId: string | null,
): Promise<BidEligibility> {
  // Checked first: during the preview there is nothing to be eligible for.
  if (status !== "BIDDING_OPEN" && status !== "EXTENDING") {
    return { canBid: false, reason: "not-open" };
  }

  if (!viewerId) return { canBid: false, reason: "not-signed-in" };

  const approvals = await prisma.bidderApproval.count({
    where: { userId: viewerId, status: "approved" },
  });
  if (approvals === 0) return { canBid: false, reason: "not-approved" };

  if (depositRequiredMinor && depositRequiredMinor > 0n) {
    const held = await prisma.deposit.count({
      where: { userId: viewerId, lotId, status: "held" },
    });
    if (held === 0) return { canBid: false, reason: "no-deposit" };
  }

  return { canBid: true };
}
