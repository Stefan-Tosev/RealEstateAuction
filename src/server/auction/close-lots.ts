import { prisma } from "@/lib/prisma";
import { enqueue } from "@/server/notifications/outbox";
import { raiseSaleFees } from "@/server/fees/raise";
import { sendBidLogToSeller } from "./seller-report";

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
        negotiation_hours: number;
        now: Date;
      }[]
    >`
      SELECT status::text, effective_close_at, reserve_price_minor, negotiation_hours,
             clock_timestamp() AS now
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

      // Nobody bid, so nobody is owed anything but their money back.
      const held = await tx.deposit.findMany({
        where: { lotId, status: "held" },
        select: { id: true, userId: true, amountMinor: true },
      });

      for (const deposit of held) {
        await tx.deposit.update({ where: { id: deposit.id }, data: { status: "released" } });
        await enqueue(
          {
            userId: deposit.userId,
            channel: "email",
            template: "deposit_released",
            payload: { lotId, amountMinor: deposit.amountMinor.toString() },
          },
          tx,
        );
      }

      /*
       * The seller is owed the record even when nothing sold — arguably
       * especially then, because "no one bid" is the claim they are most
       * entitled to see evidence for.
       */
      await sendBidLogToSeller(lotId, "CLOSED_UNSOLD", tx);

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
        /*
         * §10 gives the auctioneer a configurable 24-72 hours to bridge
         * the gap. Stamped here rather than computed on read, so the
         * bidder whose deposit is being held can be told exactly when
         * they get it back, and so the sweep is an index scan.
         */
        negotiationEndsAt: metReserve
          ? null
          : new Date(lot.now.getTime() + lot.negotiation_hours * 3_600_000),
      },
    });

    /*
     * Losing bidders get their money back now, not when someone
     * remembers. §10: "A bidder is never charged when a lot fails to
     * sell." The top bidder's stays held either way — they owe the
     * purchase price if it sold, and §10 keeps it held through the
     * negotiation window if it did not.
     */
    const losing = await tx.deposit.findMany({
      where: { lotId, status: "held", userId: { not: highest.userId } },
      select: { id: true, userId: true, amountMinor: true },
    });

    for (const deposit of losing) {
      await tx.deposit.update({ where: { id: deposit.id }, data: { status: "released" } });
      await enqueue(
        {
          userId: deposit.userId,
          channel: "email",
          template: "deposit_released",
          payload: { lotId, amountMinor: deposit.amountMinor.toString() },
        },
        tx,
      );
    }

    /*
     * Commission and premium on the hammer price — what was actually
     * bid, not the reserve. Only on a sale: a lot going into the
     * negotiation window has not sold yet, and its fees are raised if
     * and when the seller accepts.
     */
    if (metReserve) {
      await raiseSaleFees(lotId, highest.amountMinor, highest.userId, tx);
    }

    await enqueue(
      {
        userId: highest.userId,
        channel: "email",
        template: metReserve ? "lot_won" : "lot_reserve_not_met",
        payload: { lotId, amountMinor: highest.amountMinor.toString() },
      },
      tx,
    );

    /*
     * §3's access design, second half: "a seller sees the same public
     * price everyone does, never bidder identities, and gets a full
     * anonymised bid log after close."
     */
    await sendBidLogToSeller(lotId, metReserve ? "CLOSED_SOLD" : "RESERVE_NOT_MET", tx);

    return { lotId, result: metReserve ? ("sold" as const) : ("reserve-not-met" as const) };
  });
}
