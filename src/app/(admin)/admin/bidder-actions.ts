"use server";

import { revalidatePath } from "next/cache";
import type { DepositMethod, DepositStatus } from "@prisma/client";
import { changeDepositStatus, recordDeposit } from "@/server/auction/deposits";
import { decideApproval } from "@/server/identity/bidder-approvals";
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

    // Typed in euros, stored in minor units — same rule as everywhere.
    const raw = String(formData.get("amount") ?? "").replace(/[\s,]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      return { errors: { amount: "An amount like 5000 or 5000.50." } };
    }
    const [whole, fraction = ""] = raw.split(".");
    const amountMinor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));

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
