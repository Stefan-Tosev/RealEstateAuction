"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBidder } from "@/server/identity/authz";
import { hasAcceptedCurrentTerms, recordTermsAcceptance } from "@/server/identity/terms";

/*
 * Accepting a new version of the terms.
 *
 * A bidder action, so it asserts kind === "bidder": an operator browsing
 * the public site cannot accept terms on anyone's behalf.
 *
 * Failures come back as codes and the copy lives in the dictionaries, so
 * the message appears in the page's language.
 */

export type AcceptState = { code: string } | undefined;

export async function acceptTermsAction(
  locale: string,
  wording: string,
  /*
   * Already sanitised by the page through safeReturnTo. Passed in rather
   * than read from the form, so a crafted submission cannot choose where
   * the site sends someone after they accept.
   */
  returnTo: string,
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  let bidder;
  try {
    bidder = await requireBidder();
  } catch {
    return { code: "signin" };
  }

  /*
   * Unticked by default and refused when unticked. A pre-ticked or
   * implied consent is not consent under GDPR, and a consent record that
   * cannot be defended is worse than none — it looks like evidence.
   */
  if (formData.get("terms") !== "on") return { code: "errorNotTicked" };

  /*
   * Idempotent. Two submissions — a double tap, a back button — must not
   * write two rows for the same version, or the trail stops reading as
   * one acceptance per version and starts reading as noise.
   */
  if (await hasAcceptedCurrentTerms(prisma, bidder.id)) redirect(returnTo);

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");

  await recordTermsAcceptance(prisma, {
    userId: bidder.id,
    /*
     * The exact string rendered beside the checkbox, passed from the page
     * that rendered it rather than looked up here. If this module chose
     * its own wording, the record would say what this file believed and
     * not what the bidder actually read.
     */
    wording,
    ip: forwarded?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip"),
    userAgent: requestHeaders.get("user-agent"),
  });

  /*
   * Outside the try above on purpose: redirect() signals by throwing, and
   * catching it here would swallow the navigation and leave the bidder
   * staring at the form they just submitted.
   */
  redirect(returnTo);
}
