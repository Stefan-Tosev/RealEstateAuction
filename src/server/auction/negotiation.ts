import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { prisma } from "@/lib/prisma";
import { enqueue } from "@/server/notifications/outbox";
import { raiseSaleFees } from "@/server/fees/raise";
import { sendBidLogToSeller } from "./seller-report";
import { openSale } from "@/server/sales/sale";

/*
 * The post-auction negotiation window — §10.
 *
 * "When the highest bid falls below reserve, the lot enters
 * RESERVE_NOT_MET for a configurable 24–72 hours. The highest bidder's
 * deposit stays held for the duration. The auctioneer takes the bid to
 * the seller and attempts to bridge the gap. Seller accepts →
 * CLOSED_SOLD at the bid amount. Window expires or either side declines
 * → CLOSED_UNSOLD, deposit released immediately."
 *
 * Until this existed, RESERVE_NOT_MET had no onward transition at all —
 * a lot that closed under reserve was stuck there permanently. That is
 * the worst of the endings to strand, because it is the one with a
 * verified buyer who has money down and still wants the property. §10:
 * "an unmet reserve is not a failure to be penalised — it is a warm lead
 * with a known price and an already-verified buyer."
 */

export type NegotiationOutcome = "accepted" | "declined" | "expired";

/**
 * Accept the top bid on the seller's behalf, closing the lot as sold at
 * that amount.
 *
 * The reserve is not rewritten. It stays on the record as what the seller
 * originally wanted, and the sale price is the bid — anything else would
 * erase the evidence that a negotiation happened at all.
 */
export async function acceptTopBid(
  actor: AdminActor,
  lotId: string,
  notes: string | null,
): Promise<void> {
  const lot = await claim(lotId);

  await prisma.lot.update({
    where: { id: lotId },
    data: { status: "CLOSED_SOLD", negotiationEndsAt: null },
  });

  if (lot.winningBid) {
    /*
     * Charged on the hammer price, which here is below the reserve. The
     * seller agreed to sell at this number; billing them a commission on
     * the reserve would be a fee on a price nobody paid.
     */
    await raiseSaleFees(lotId, lot.winningBid.amountMinor, lot.winningBid.userId);
    // The other route to CLOSED_SOLD, and it needs a sale just as much.
    await openSale(lotId, lot.winningBid.userId, lot.winningBid.amountMinor);

    await enqueue({
      userId: lot.winningBid.userId,
      channel: "email",
      template: "lot_won",
      payload: { lotId, amountMinor: lot.winningBid.amountMinor.toString() },
    });
  }

  /*
   * The winner's deposit stays held: they now owe the purchase price, and
   * the deposit is what secures it. Everyone else's goes back.
   */
  await releaseDeposits(lotId, lot.winningBid?.userId ?? null);

  // The lot only reaches its final price here, so the report the seller
  // received at RESERVE_NOT_MET is now out of date.
  await sendBidLogToSeller(lotId, "CLOSED_SOLD");

  await recordAudit({
    actorId: actor.id,
    action: "lot.negotiationAccepted",
    entityType: "lot",
    entityId: lotId,
    before: { status: "RESERVE_NOT_MET", reservePriceMinor: lot.reservePriceMinor.toString() },
    after: {
      status: "CLOSED_SOLD",
      soldAtMinor: lot.winningBid?.amountMinor.toString() ?? null,
      notes,
    },
  });
}

/**
 * The seller said no, or the auctioneer is closing the window early.
 *
 * §10: "no exceptions" on the refund. A bidder is never out of pocket
 * because a lot failed to sell.
 */
export async function declineTopBid(
  actor: AdminActor,
  lotId: string,
  notes: string | null,
): Promise<void> {
  const lot = await claim(lotId);

  await prisma.lot.update({
    where: { id: lotId },
    data: { status: "CLOSED_UNSOLD", negotiationEndsAt: null },
  });

  await releaseDeposits(lotId, null);
  await sendBidLogToSeller(lotId, "CLOSED_UNSOLD");

  await recordAudit({
    actorId: actor.id,
    action: "lot.negotiationDeclined",
    entityType: "lot",
    entityId: lotId,
    before: { status: "RESERVE_NOT_MET" },
    after: { status: "CLOSED_UNSOLD", notes },
  });
}

/**
 * Close the windows that have run out — driven by the same worker that
 * closes lots.
 *
 * An expiry is a decline that nobody got round to making, and it must
 * behave identically: a bidder's money cannot stay held because an
 * auctioneer was on holiday.
 */
export async function expireNegotiationWindows(limit = 20): Promise<string[]> {
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM lots
     WHERE status = 'RESERVE_NOT_MET'
       AND negotiation_ends_at IS NOT NULL
       AND negotiation_ends_at <= clock_timestamp()
     LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
  `;

  const expired: string[] = [];

  for (const { id } of due) {
    /*
     * Re-checked under the lock: an auctioneer may have accepted between
     * the scan and here, and expiring an accepted sale would be the
     * worst possible race to lose.
     */
    const lot = await prisma.lot.findUnique({ where: { id }, select: { status: true } });
    if (lot?.status !== "RESERVE_NOT_MET") continue;

    await prisma.lot.update({
      where: { id },
      data: { status: "CLOSED_UNSOLD", negotiationEndsAt: null },
    });

    await releaseDeposits(id, null);

    /*
     * actorId null: nobody decided this, the clock did. Recording a
     * person here would put a name against a decision they never made.
     */
    await recordAudit({
      actorId: null,
      action: "lot.negotiationExpired",
      entityType: "lot",
      entityId: id,
      before: { status: "RESERVE_NOT_MET" },
      after: { status: "CLOSED_UNSOLD" },
    });

    expired.push(id);
  }

  return expired;
}

async function claim(lotId: string) {
  const lot = await prisma.lot.findUniqueOrThrow({
    where: { id: lotId },
    select: {
      status: true,
      reservePriceMinor: true,
      winningBid: { select: { userId: true, amountMinor: true } },
    },
  });

  if (lot.status !== "RESERVE_NOT_MET") {
    throw new Error(`Lot ${lotId} is ${lot.status}, not in a negotiation window.`);
  }

  return lot;
}

/**
 * Give back every held deposit on the lot except, optionally, the
 * winner's.
 *
 * Losing bidders' money going back automatically is the point. Leaving it
 * to an operator to remember means somebody's five figures sits with us
 * because a checkbox was missed, and they have no way to see it or chase
 * it.
 */
async function releaseDeposits(lotId: string, keepHeldForUserId: string | null): Promise<void> {
  const held = await prisma.deposit.findMany({
    where: {
      lotId,
      status: "held",
      ...(keepHeldForUserId ? { userId: { not: keepHeldForUserId } } : {}),
    },
    select: { id: true, userId: true, amountMinor: true },
  });

  for (const deposit of held) {
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "released" } });
    await enqueue({
      userId: deposit.userId,
      channel: "email",
      template: "deposit_released",
      payload: { lotId, amountMinor: deposit.amountMinor.toString() },
    });
  }
}
