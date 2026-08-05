import { prisma } from "@/lib/prisma";
import { enqueue } from "@/server/notifications/outbox";

/*
 * Closing lots whose clock has run out — §3, "Closing a lot".
 *
 * Claims due lots with FOR UPDATE SKIP LOCKED so several workers can run
 * without treading on each other, then re-checks effective_close_at
 * *inside* the lock: a bid may have extended it between the scan and the
 * claim, and closing a lot that has just been extended would break the
 * anti-snipe promise in the most visible way possible.
 *
 * Idempotent by construction — a lot already in a closed state is not
 * selected, and the status update is guarded by the same lock the bid
 * transaction takes.
 */

export type CloseOutcome = {
  lotId: string;
  result: "sold" | "unsold" | "reserve-not-met" | "extended" | "skipped";
};

/*
 * An unmet reserve is NOT terminal (§1, §10): it opens a 24–72h
 * negotiation window in which the auctioneer takes the top bid to the
 * seller. Closing straight to UNSOLD would throw away a warm lead with a
 * known price and an already-verified buyer.
 */
export async function closeDueLots(limit = 20): Promise<CloseOutcome[]> {
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM lots
     WHERE status IN ('BIDDING_OPEN', 'EXTENDING')
       AND effective_close_at <= clock_timestamp()
     LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
  `;

  const outcomes: CloseOutcome[] = [];
  for (const { id } of due) {
    outcomes.push(await closeLot(id));
  }
  return outcomes;
}

export async function closeLot(lotId: string): Promise<CloseOutcome> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      {
        status: string;
        effective_close_at: Date | null;
        reserve_price_minor: bigint;
        now: Date;
      }[]
    >`
      SELECT status::text, effective_close_at, reserve_price_minor, clock_timestamp() AS now
        FROM lots
       WHERE id = ${lotId}::uuid
         FOR UPDATE
    `;

    const lot = locked[0];
    if (!lot) return { lotId, result: "skipped" as const };

    // Another worker may have closed it between the scan and this lock.
    if (lot.status !== "BIDDING_OPEN" && lot.status !== "EXTENDING") {
      return { lotId, result: "skipped" as const };
    }

    /*
     * The re-check that matters. A bid landing between the scan and this
     * lock will have pushed effective_close_at forward, and this lot is
     * no longer due.
     */
    if (!lot.effective_close_at || lot.effective_close_at > lot.now) {
      return { lotId, result: "extended" as const };
    }

    const highest = await tx.bid.findFirst({
      where: { lotId, status: "accepted" },
      orderBy: [{ amountMinor: "desc" }, { receivedAt: "asc" }],
      select: { id: true, amountMinor: true, userId: true },
    });

    if (!highest) {
      await tx.lot.update({
        where: { id: lotId },
        data: { status: "CLOSED_UNSOLD", closedAt: lot.now },
      });
      return { lotId, result: "unsold" as const };
    }

    const metReserve = highest.amountMinor >= lot.reserve_price_minor;

    await tx.lot.update({
      where: { id: lotId },
      data: {
        status: metReserve ? "CLOSED_SOLD" : "RESERVE_NOT_MET",
        closedAt: lot.now,
        // Recorded either way: in the reserve-not-met window the top bid
        // is precisely what the auctioneer takes to the seller.
        winningBidId: highest.id,
      },
    });

    await enqueue(
      {
        userId: highest.userId,
        channel: "email",
        template: metReserve ? "lot_won" : "lot_reserve_not_met",
        payload: { lotId, amountMinor: highest.amountMinor.toString() },
      },
      tx,
    );

    return { lotId, result: metReserve ? ("sold" as const) : ("reserve-not-met" as const) };
  });
}
