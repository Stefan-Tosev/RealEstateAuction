"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { placeBid } from "@/server/auction/place-bid";
import { requireBidder } from "@/server/identity/authz";

/*
 * Placing a bid from the browser.
 *
 * Everything that decides the outcome happens in placeBid, inside one
 * transaction under a row lock. This wrapper only turns a form into that
 * call and a result into a code the page can render in either language.
 *
 * The amount is parsed here from euros to minor units as strings — the
 * same rule as everywhere else, never Number(v) * 100.
 */

export type BidState =
  | { ok: true; code: "accepted" | "acceptedExtended" }
  | { ok: false; code: string }
  | undefined;

export async function placeBidAction(
  locale: string,
  slug: string,
  lotId: string,
  _prev: BidState,
  formData: FormData,
): Promise<BidState> {
  let bidder;
  try {
    bidder = await requireBidder();
  } catch {
    return { ok: false, code: "signInToBid" };
  }

  const raw = String(formData.get("amount") ?? "").replace(/[\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, code: "errorTooLow" };
  }
  const [whole, fraction = ""] = raw.split(".");
  const amountMinor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));

  /*
   * The identity of this submission: which form, at which state of the
   * lot, for how much.
   *
   * The amount belongs in it. Without it, a bidder who is rejected as
   * too low and then corrects their figure sends the same key again —
   * a rejection does not move the lot's state — and placeBid replays
   * the rejection instead of considering the new amount. The bidder
   * watches a valid bid fail for no stated reason.
   *
   * With it, the key still covers what it must: two clicks on one form
   * with one amount are one bid.
   */
  const formKey = String(formData.get("idempotencyKey") ?? "").slice(0, 80);
  if (!formKey) return { ok: false, code: "errorGeneric" };
  const idempotencyKey = `${formKey}:${amountMinor}`;

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");

  const result = await placeBid({
    lotId,
    userId: bidder.id,
    amountMinor,
    idempotencyKey,
    clientIp: forwarded?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip"),
    userAgent: requestHeaders.get("user-agent"),
  });

  revalidatePath(`/${locale}/lots/${slug}`);

  if (result.ok) {
    return { ok: true, code: result.extendedTo ? "acceptedExtended" : "accepted" };
  }

  switch (result.reason) {
    case "TOO_LOW":
      return { ok: false, code: "errorTooLow" };
    case "CLOSED":
      return { ok: false, code: "errorClosed" };
    case "NOT_APPROVED":
      return { ok: false, code: "errorNotApproved" };
    case "NO_DEPOSIT":
      return { ok: false, code: "errorNoDeposit" };
    case "NOT_OPEN":
      return { ok: false, code: "errorNotOpen" };
    default:
      return { ok: false, code: "errorGeneric" };
  }
}
