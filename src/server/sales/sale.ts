import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { enqueue } from "@/server/notifications/outbox";

/*
 * A sale in progress — §3.3 of docs/open-items.md, the gap between "you
 * won" and the keys.
 *
 * The Bulgarian sequence this follows: a preliminary contract, the
 * balance paid, then the нотариален акт signed before a notary, which is
 * the transfer itself.
 *
 * Milestones are stored as timestamps, not as a status column somebody
 * has to remember to advance. Each is a fact with a date; the status is
 * derived from them below, so the two cannot drift apart — which is the
 * failure mode of every hand-maintained status field.
 */

/** How long a buyer has, from the fall of the hammer. */
export const COMPLETION_DAYS = 30;

export type SaleStatus =
  | "awaiting-contract"
  | "awaiting-balance"
  | "awaiting-completion"
  | "completed"
  | "defaulted";

type Milestones = {
  contractSignedAt: Date | null;
  balancePaidAt: Date | null;
  completedAt: Date | null;
  defaultedAt: Date | null;
};

/**
 * Read the status off the facts.
 *
 * Order matters: the terminal outcomes win, because a defaulted sale that
 * happens to have a signed contract is defaulted, not "awaiting balance".
 */
export function saleStatus(sale: Milestones): SaleStatus {
  if (sale.defaultedAt) return "defaulted";
  if (sale.completedAt) return "completed";
  if (sale.balancePaidAt) return "awaiting-completion";
  if (sale.contractSignedAt) return "awaiting-balance";
  return "awaiting-contract";
}

/** Past its deadline and not finished either way. */
export function isOverdue(
  sale: Milestones & { completionDueAt: Date },
  now = new Date(),
): boolean {
  if (sale.completedAt || sale.defaultedAt) return false;
  return sale.completionDueAt <= now;
}

/** The hammer price less what is already held. Never below zero. */
export function balanceMinor(hammerMinor: bigint, depositMinor: bigint): bigint {
  const balance = hammerMinor - depositMinor;
  return balance > 0n ? balance : 0n;
}

type Client = Prisma.TransactionClient;

/**
 * Open a sale the moment a lot is sold.
 *
 * Called from both places a lot can reach CLOSED_SOLD — the closing
 * worker and an accepted negotiation — because a sold lot with no sale
 * record is precisely the hole this exists to close.
 *
 * Idempotent through the unique constraint on lotId: a close that runs
 * twice must not open two sales.
 */
export async function openSale(
  lotId: string,
  buyerUserId: string,
  hammerMinor: bigint,
  client: Client = prisma,
): Promise<boolean> {
  /*
   * The deposit counts toward the price — that is what it was taken for
   * — so the balance is the hammer less what is already held. Only
   * deposits still `held` count; a released one is gone.
   */
  const deposits = await client.deposit.findMany({
    where: { lotId, userId: buyerUserId, status: "held" },
    select: { amountMinor: true },
  });
  const depositMinor = deposits.reduce((total, d) => total + d.amountMinor, 0n);

  const completionDueAt = new Date(Date.now() + COMPLETION_DAYS * 86_400_000);

  const created = await client.sale.createMany({
    data: { lotId, userId: buyerUserId, hammerMinor, depositMinor, completionDueAt },
    skipDuplicates: true,
  });

  if (created.count === 0) return false;

  /*
   * What the buyer actually needs: the number to pay, by when, and that
   * their deposit has been taken off it. Sent through the outbox so a
   * provider outage delays it rather than losing it.
   */
  await enqueue(
    {
      userId: buyerUserId,
      channel: "email",
      template: "sale_next_steps",
      payload: {
        lotId,
        hammerMinor: hammerMinor.toString(),
        depositMinor: depositMinor.toString(),
        balanceMinor: balanceMinor(hammerMinor, depositMinor).toString(),
        completionDueAtIso: completionDueAt.toISOString(),
      },
    },
    client,
  );

  return true;
}

export type Milestone = "contract" | "balance" | "completed";

const FIELD: Record<Milestone, keyof Milestones> = {
  contract: "contractSignedAt",
  balance: "balancePaidAt",
  completed: "completedAt",
};

/**
 * Record that a milestone happened.
 *
 * Deliberately not a state machine that refuses out-of-order entries. An
 * operator catching up on a sale that completed last week needs to be
 * able to record the contract after the completion, and a system that
 * argues with them just gets worked around in a spreadsheet.
 */
export async function recordMilestone(
  actor: AdminActor,
  saleId: string,
  milestone: Milestone,
  at: Date,
  note: string | null,
): Promise<void> {
  const before = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: {
      lotId: true,
      userId: true,
      defaultedAt: true,
      contractSignedAt: true,
      balancePaidAt: true,
      completedAt: true,
    },
  });

  if (before.defaultedAt) {
    throw new Error("This sale is recorded as defaulted. Undo that before adding milestones.");
  }

  await prisma.sale.update({
    where: { id: saleId },
    data: { [FIELD[milestone]]: at, ...(note ? { notes: note } : {}) },
  });

  /*
   * Completion is the point the property changes hands, so the deposit
   * has done its job and the money is settled. Marking it refunded rather
   * than released: released means "given back because nothing happened",
   * and that is not what occurred here.
   */
  if (milestone === "completed") {
    await prisma.deposit.updateMany({
      where: { lotId: before.lotId, userId: before.userId, status: "held" },
      data: { status: "refunded" },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: `sale.${milestone}`,
    entityType: "sale",
    entityId: saleId,
    after: { at: at.toISOString(), note },
  });
}

/**
 * The buyer walked away.
 *
 * Forfeits the deposit, which is what it is for — and which is only
 * enforceable if the bidder terms say so. That wording is still
 * outstanding; see docs/open-items.md.
 */
export async function recordDefault(
  actor: AdminActor,
  saleId: string,
  reason: string,
): Promise<void> {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: { lotId: true, userId: true, completedAt: true },
  });

  if (sale.completedAt) {
    throw new Error("This sale has completed. It cannot be marked defaulted.");
  }

  await prisma.sale.update({
    where: { id: saleId },
    data: { defaultedAt: new Date(), notes: reason },
  });

  await prisma.deposit.updateMany({
    where: { lotId: sale.lotId, userId: sale.userId, status: "held" },
    data: { status: "forfeited" },
  });

  await recordAudit({
    actorId: actor.id,
    action: "sale.defaulted",
    entityType: "sale",
    entityId: saleId,
    after: { reason },
  });
}

/** Every sale, newest first — the operations view. */
export async function listSales() {
  const sales = await prisma.sale.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hammerMinor: true,
      depositMinor: true,
      completionDueAt: true,
      contractSignedAt: true,
      balancePaidAt: true,
      completedAt: true,
      defaultedAt: true,
      lot: { select: { lotNumber: true, property: { select: { titleBg: true } } } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return sales.map((sale) => ({
    ...sale,
    status: saleStatus(sale),
    overdue: isOverdue(sale),
    balanceMinor: balanceMinor(sale.hammerMinor, sale.depositMinor),
  }));
}

export async function getSale(id: string) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      lot: { select: { lotNumber: true, property: { select: { titleBg: true, address: true } } } },
      user: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });

  if (!sale) return null;

  return {
    ...sale,
    status: saleStatus(sale),
    overdue: isOverdue(sale),
    balanceMinor: balanceMinor(sale.hammerMinor, sale.depositMinor),
  };
}
