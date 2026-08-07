"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyInput } from "@/lib/money";
import type { DepositMethod, DepositStatus } from "@prisma/client";
import { changeDepositStatus, recordDeposit } from "@/server/auction/deposits";
import { decideApproval } from "@/server/identity/bidder-approvals";
import { acceptTopBid, declineTopBid } from "@/server/auction/negotiation";
import { AuthorizationError, requireAdmin, requireRoleFor } from "@/server/identity/authz";
import type { FormState } from "./catalogue-actions";

/*
 * Bidder approval and deposit recording.
 *
 * Both are reserved to the `admin` role rather than `staff`. Approving a
 * bidder decides who may commit to a five-figure purchase, and recording
 * a deposit is the first point the system asserts that money arrived —
 * neither is data entry.
 */

function toFormState(error: unknown): FormState {
  if (error instanceof AuthorizationError) return { message: error.message };
  if (error instanceof Error) return { message: error.message };
  throw error;
}

export async function decideBidderAction(
  userId: string,
  status: "approved" | "rejected",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRoleFor("bidder.decide");
    await decideApproval(actor, userId, status, String(formData.get("notes") ?? ""));
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath("/admin/bidders");
  return { message: status === "approved" ? "Bidder approved." : "Bidder rejected." };
}

export async function recordDepositAction(
  lotId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRoleFor("deposit.record");

    const userId = String(formData.get("userId") ?? "");
    if (!userId) return { errors: { userId: "Choose a bidder." } };

    // Typed in euros, stored in minor units. parseMoneyInput reads both
    // conventions — an operator writing "5 000,50" means 5000.50, and
    // treating that comma as grouping would record a hundred times the
    // deposit that actually arrived.
    const amountMinor = parseMoneyInput(String(formData.get("amount") ?? ""));
    if (amountMinor === null) {
      return { errors: { amount: "An amount like 5000 or 5000.50." } };
    }

    const method = String(formData.get("method") ?? "") as DepositMethod;
    if (method !== "sepa" && method !== "card_hold") {
      return { errors: { method: "Choose how it was paid." } };
    }

    await recordDeposit(actor, {
      lotId,
      userId,
      amountMinor,
      method,
      providerRef: String(formData.get("providerRef") ?? ""),
    });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  return { message: "Deposit recorded." };
}

export async function setDepositStatusAction(lotId: string, formData: FormData): Promise<void> {
  await requireRoleFor("deposit.record");
  const actor = await requireAdmin();

  const status = String(formData.get("status")) as DepositStatus;
  const allowed: DepositStatus[] = ["pending", "held", "released", "forfeited", "refunded"];
  if (!allowed.includes(status)) return;

  await changeDepositStatus(actor, String(formData.get("depositId")), status);
  revalidatePath(`/admin/lots/${lotId}`);
}

/*
 * The post-auction negotiation window — §10.
 *
 * Accepting closes the lot as sold at the top bid, below the reserve the
 * seller agreed to. That is a commercial decision with a signature
 * behind it, which is why it is reserved to the auctioneer and why the
 * note is recorded: "the seller said yes on the phone" is exactly the
 * kind of thing that has to be written down somewhere durable.
 */
export async function decideNegotiationAction(
  lotId: string,
  outcome: "accept" | "decline",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRoleFor("lot.negotiate");
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (outcome === "accept") {
      await acceptTopBid(actor, lotId, notes);
    } else {
      await declineTopBid(actor, lotId, notes);
    }
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/admin/lots");
  return {
    message:
      outcome === "accept"
        ? "Sold at the top bid. The buyer has been told."
        : "Closed unsold. Deposits have been released.",
  };
}
