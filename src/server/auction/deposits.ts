import type { DepositMethod, DepositStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { enqueue } from "@/server/notifications/outbox";

/*
 * Deposits, recorded by an operator.
 *
 * This is not a stand-in for a payment integration — it is the design
 * §9 describes: "card pre-authorisation holds generally fail at
 * property-deposit sizes — SEPA transfer is the realistic mechanism,
 * which means manual reconciliation. Budget the operational time; this
 * surprises people."
 *
 * So somebody watches a bank account and marks money as received. A
 * payment provider at Phase 5 changes where the confirmation comes from,
 * not what the record means.
 *
 * Every state change is audited. This is the first place the system
 * touches money, and "who marked this deposit as held" is a question
 * that will be asked.
 */

export type DepositRow = {
  id: string;
  userId: string;
  bidderName: string;
  bidderEmail: string;
  amountMinor: bigint;
  method: DepositMethod;
  status: DepositStatus;
  providerRef: string | null;
  createdAt: Date;
};

export async function listDepositsForLot(lotId: string): Promise<DepositRow[]> {
  const deposits = await prisma.deposit.findMany({
    where: { lotId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  });

  return deposits.map((deposit) => ({
    id: deposit.id,
    userId: deposit.userId,
    bidderName: `${deposit.user.firstName} ${deposit.user.lastName}`.trim(),
    bidderEmail: deposit.user.email,
    amountMinor: deposit.amountMinor,
    method: deposit.method,
    status: deposit.status,
    providerRef: deposit.providerRef,
    createdAt: deposit.createdAt,
  }));
}

/** Approved bidders with no deposit yet on this lot — the ones an operator can add. */
export async function bidderOptionsForLot(lotId: string) {
  const approved = await prisma.user.findMany({
    where: {
      status: "active",
      emailVerifiedAt: { not: null },
      bidderApprovals: { some: { status: "approved" } },
      deposits: { none: { lotId } },
    },
    orderBy: { lastName: "asc" },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  return approved.map((user) => ({
    id: user.id,
    label: `${user.firstName} ${user.lastName} — ${user.email}`,
  }));
}

export async function recordDeposit(
  actor: AdminActor,
  input: {
    lotId: string;
    userId: string;
    amountMinor: bigint;
    method: DepositMethod;
    providerRef: string | null;
  },
): Promise<void> {
  const deposit = await prisma.deposit.create({
    data: {
      lotId: input.lotId,
      userId: input.userId,
      amountMinor: input.amountMinor,
      method: input.method,
      // Recorded as held: an operator adds this only once the money has
      // actually arrived. "Pending" would be a deposit nobody has seen.
      status: "held",
      providerRef: input.providerRef?.trim() || null,
    },
  });

  await enqueue({
    userId: input.userId,
    channel: "email",
    template: "deposit_received",
    payload: { lotId: input.lotId, amountMinor: input.amountMinor.toString() },
  });

  await recordAudit({
    actorId: actor.id,
    action: "deposit.record",
    entityType: "lot",
    entityId: input.lotId,
    after: {
      depositId: deposit.id,
      userId: input.userId,
      amountMinor: input.amountMinor.toString(),
      method: input.method,
      providerRef: deposit.providerRef,
    },
  });
}

export async function changeDepositStatus(
  actor: AdminActor,
  depositId: string,
  status: DepositStatus,
): Promise<void> {
  const before = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });

  await prisma.deposit.update({ where: { id: depositId }, data: { status } });

  /*
   * §10: "A bidder is never charged when a lot fails to sell. Deposit
   * refunded in full, no exceptions." Releasing is therefore the normal
   * ending, not an exception path.
   */
  if (status === "released") {
    await enqueue({
      userId: before.userId,
      channel: "email",
      template: "deposit_released",
      payload: { lotId: before.lotId, amountMinor: before.amountMinor.toString() },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: `deposit.${status}`,
    entityType: "lot",
    entityId: before.lotId,
    before: { status: before.status },
    after: { status },
  });
}

/**
 * The highest accepted bid on a lot, or null if nobody bid.
 *
 * Lives here rather than in bidding-view because the admin needs it
 * alongside the reserve, and bidding-view is the one place that must
 * never see a reserve — invariant 7. Keeping the two apart is what stops
 * a convenient shared type quietly carrying it into a public payload.
 */
export async function topBidForLot(lotId: string): Promise<bigint | null> {
  const highest = await prisma.bid.aggregate({
    where: { lotId, status: "accepted" },
    _max: { amountMinor: true },
  });
  return highest._max.amountMinor ?? null;
}
