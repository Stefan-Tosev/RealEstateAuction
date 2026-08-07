"use server";

import { revalidatePath } from "next/cache";
import { recordDefault, recordMilestone, type Milestone } from "@/server/sales/sale";
import { AuthorizationError, requireRoleFor } from "@/server/identity/authz";
import type { FormState } from "./catalogue-actions";

/*
 * Recording what has happened on a sale.
 *
 * Reserved to the auctioneer, like deposits and invoices: these entries
 * decide whether somebody's five-figure deposit is returned or forfeited.
 */

function toState(error: unknown): FormState {
  if (error instanceof AuthorizationError) return { message: error.message };
  if (error instanceof Error) return { message: error.message };
  throw error;
}

export async function recordMilestoneAction(
  saleId: string,
  milestone: Milestone,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  /*
   * A date, because these are recorded after the fact. The contract was
   * signed at the notary on Tuesday; somebody types it in on Thursday,
   * and "now" would be wrong.
   */
  const raw = String(formData.get("at") ?? "").trim();
  const at = raw ? new Date(raw) : new Date();
  if (Number.isNaN(at.getTime())) return { message: "That date could not be read." };

  try {
    const actor = await requireRoleFor("deposit.record");
    await recordMilestone(actor, saleId, milestone, at, String(formData.get("note") ?? "").trim() || null);
  } catch (error) {
    return toState(error);
  }

  revalidatePath(`/admin/sales/${saleId}`);
  revalidatePath("/admin/sales");
  return { message: "Recorded." };
}

export async function recordDefaultAction(
  saleId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { message: "Say what happened — forfeiting a deposit needs a reason on the record." };
  }

  try {
    const actor = await requireRoleFor("deposit.record");
    await recordDefault(actor, saleId, reason);
  } catch (error) {
    return toState(error);
  }

  revalidatePath(`/admin/sales/${saleId}`);
  revalidatePath("/admin/sales");
  return { message: "Recorded as defaulted. The deposit is forfeited." };
}
