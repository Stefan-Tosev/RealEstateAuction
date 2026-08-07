"use server";

import { CopyUnavailable, copyDraftingConfigured, draftListingCopy } from "@/server/copy/draft";
import type { DraftResult } from "@/server/copy/types";
import { AuthorizationError, requireAdmin } from "@/server/identity/authz";

/*
 * Drafting listing copy from the property form.
 *
 * Returns the draft to the operator; it never saves. A person reads,
 * edits and presses Save — which is what keeps someone accountable for
 * words published as the auction house's own, and misdescription by an
 * agent is the agent's liability.
 *
 * Any operator may draft. This writes nothing and decides nothing, so
 * the stricter role gates that guard reserves and deposits would be
 * ceremony rather than protection.
 */

export type DraftCopyState =
  | { ok: true; result: DraftResult }
  | { ok: false; message: string }
  | undefined;

export async function draftCopyAction(
  _prev: DraftCopyState,
  formData: FormData,
): Promise<DraftCopyState> {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, message: error.message };
    throw error;
  }

  if (!copyDraftingConfigured()) {
    return {
      ok: false,
      message:
        "Copy drafting is not configured on this server (ANTHROPIC_API_KEY is unset). Write the descriptions by hand.",
    };
  }

  const number = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  try {
    const result = await draftListingCopy({
      propertyType: String(formData.get("propertyType") ?? "apartment"),
      city: String(formData.get("city") ?? "").trim(),
      region: String(formData.get("region") ?? "").trim(),
      address: String(formData.get("address") ?? "").trim(),
      rooms: number("rooms"),
      areaSqm: number("areaSqm"),
      floor: number("floor"),
      yearBuilt: number("yearBuilt"),
      notes: String(formData.get("copyNotes") ?? ""),
    });

    return { ok: true, result };
  } catch (error) {
    if (error instanceof CopyUnavailable) return { ok: false, message: error.message };
    // Anything else is a bug rather than a provider saying no.
    throw error;
  }
}
