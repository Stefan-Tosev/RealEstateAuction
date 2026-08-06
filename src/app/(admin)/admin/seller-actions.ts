"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSeller, sellerSchema, updateSeller } from "@/server/sellers/admin";
import { AuthorizationError, requireAdmin } from "@/server/identity/authz";
import type { FormState } from "./catalogue-actions";

/*
 * Seller records.
 *
 * Any operator may maintain them: this is contact data for running a
 * transaction, not a decision with money attached. The stricter role
 * gates guard agreeing reserves and recording deposits.
 */
export async function saveSellerAction(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) return { message: error.message };
    throw error;
  }

  const submitted = {
    kind: String(formData.get("kind") ?? "individual"),
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    eik: String(formData.get("eik") ?? ""),
    vat: String(formData.get("vat") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };

  const parsed = sellerSchema.safeParse(submitted);

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "name");
      errors[field] ??= issue.message;
    }
    /*
     * Echoed back because React 19 resets an uncontrolled form once its
     * action completes — without this, a rejected ЕИК costs the operator
     * everything else they typed.
     */
    return { message: "Check the highlighted fields.", errors, values: submitted };
  }

  if (id) {
    await updateSeller(actor, id, parsed.data);
  } else {
    await createSeller(actor, parsed.data);
  }

  revalidatePath("/admin/sellers");
  redirect("/admin/sellers");
}
