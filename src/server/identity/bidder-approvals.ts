import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "./authz";

/*
 * Manual bidder approval.
 *
 * §9 of the architecture is explicit that this is correct at MVP volume:
 * "Phase 2 uses manual review; wire a provider at Phase 5." No KYC
 * vendor, no document upload, no sanctions screening — an operator
 * looking at an account and deciding.
 *
 * What it unlocks is real, though: the NOT_APPROVED bid gate, and the
 * approved-bidders document tier that until now was reachable by nobody.
 *
 * A user may accumulate several approval rows — a rejection followed by
 * a later approval — so "is approved" is always "has at least one row
 * with status approved", never "the newest row says so".
 */

export type BidderRow = {
  id: string;
  email: string;
  name: string;
  accountType: string;
  companyName: string | null;
  eik: string | null;
  verified: boolean;
  registeredAt: Date;
  status: ApprovalStatus | "none";
  reviewedBy: string | null;
  reviewedAt: Date | null;
  notes: string | null;
};

export async function listBidders(): Promise<BidderRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      bidderApprovals: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { name: true } } },
      },
    },
  });

  return users.map((user) => {
    // The decision that counts, not merely the latest one.
    const approved = user.bidderApprovals.find((a) => a.status === "approved");
    const latest = approved ?? user.bidderApprovals[0];

    return {
      id: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      accountType: user.accountType,
      companyName: user.companyName,
      eik: user.eik,
      verified: user.emailVerifiedAt !== null,
      registeredAt: user.createdAt,
      status: latest?.status ?? "none",
      reviewedBy: latest?.reviewer?.name ?? null,
      reviewedAt: latest?.reviewedAt ?? null,
      notes: latest?.notes ?? null,
    };
  });
}

export async function decideApproval(
  actor: AdminActor,
  userId: string,
  status: Extract<ApprovalStatus, "approved" | "rejected">,
  notes: string | null,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });

  /*
   * Refuse to approve an unconfirmed address. Approval is the gate that
   * lets someone commit to a five-figure purchase; doing it for an
   * address nobody has proven they control is the wrong order.
   */
  if (status === "approved" && !user.emailVerifiedAt) {
    throw new Error("This bidder has not confirmed their email address yet.");
  }

  const approval = await prisma.bidderApproval.create({
    data: {
      userId,
      status,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      notes: notes?.trim() || null,
    },
  });

  /*
   * A new row each time rather than an update, so the history of
   * decisions survives. Who approved a bidder, when, and on what note is
   * exactly what an AML audit asks for — and §7 puts KYC records under a
   * five-year retention that overrides erasure.
   */
  await recordAudit({
    actorId: actor.id,
    action: `bidder.${status}`,
    entityType: "admin_user",
    entityId: userId,
    after: { approvalId: approval.id, status, notes: approval.notes },
  });
}

/** Whether this user may bid. Mirrors the gate in place-bid.ts. */
export async function isApproved(userId: string): Promise<boolean> {
  const count = await prisma.bidderApproval.count({
    where: { userId, status: "approved" },
  });
  return count > 0;
}
