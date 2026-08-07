"use server";

import { revalidatePath } from "next/cache";
import type { FeeParty } from "@prisma/client";
import { InvoiceRefused, cancelInvoice, markInvoicePaid, raiseInvoice } from "@/server/fees/invoice";
import { AuthorizationError, requireRoleFor } from "@/server/identity/authz";
import type { FormState } from "./catalogue-actions";

/*
 * Invoicing.
 *
 * Reserved to the auctioneer, like recording a deposit: issuing an
 * invoice is the point the house asserts somebody owes it money, and the
 * number it carries is part of a sequence an auditor will read.
 */

function toState(error: unknown): FormState {
  if (error instanceof InvoiceRefused) return { message: error.message };
  if (error instanceof AuthorizationError) return { message: error.message };
  throw error;
}

export async function raiseInvoiceAction(
  lotId: string,
  party: FeeParty,
  _prev: FormState,
): Promise<FormState> {
  let number: string;
  try {
    const actor = await requireRoleFor("deposit.record");
    ({ number } = await raiseInvoice(actor, lotId, party));
  } catch (error) {
    return toState(error);
  }

  revalidatePath(`/admin/lots/${lotId}`);
  revalidatePath("/admin/invoices");
  return { message: `Invoice ${number} raised.` };
}

export async function markInvoicePaidAction(
  invoiceId: string,
  _prev: FormState,
): Promise<FormState> {
  try {
    const actor = await requireRoleFor("deposit.record");
    await markInvoicePaid(actor, invoiceId);
  } catch (error) {
    return toState(error);
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { message: "Marked as paid." };
}

export async function cancelInvoiceAction(
  invoiceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { message: "Say why it is being cancelled — the invoice keeps the note." };

  try {
    const actor = await requireRoleFor("deposit.record");
    await cancelInvoice(actor, invoiceId, reason);
  } catch (error) {
    return toState(error);
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { message: "Cancelled. Its fees are due again, and the number stays used." };
}
