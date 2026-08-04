import type { DocumentVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * Who may download which document.
 *
 * §5 defines three tiers: headline info public, the full pack behind
 * registration, and a further tier for approved bidders. The last one is
 * important and currently unreachable — BidderApproval exists in the
 * schema but nothing sets it, because manual approval is Phase 2. So
 * `approved_bidders` documents are visible to NOBODY today.
 *
 * That is the honest behaviour, and better than the alternative of
 * quietly treating "registered" as good enough: an operator who marks a
 * document approved-bidders-only has said something specific about it,
 * and downgrading that silently would be a disclosure they did not
 * authorise. The admin UI says so plainly at the point of choosing.
 */

export type Viewer =
  | { kind: "anonymous" }
  | { kind: "bidder"; userId: string }
  /* Operators see everything; they are the ones who uploaded it. */
  | { kind: "admin" };

export type AccessDecision = {
  allowed: boolean;
  /** Why not, for the UI to explain rather than just refuse. */
  reason?: "sign-in-required" | "approval-required";
};

export async function canAccess(
  visibility: DocumentVisibility,
  viewer: Viewer,
): Promise<AccessDecision> {
  if (viewer.kind === "admin") return { allowed: true };

  switch (visibility) {
    case "public":
      return { allowed: true };

    case "registered":
      return viewer.kind === "bidder"
        ? { allowed: true }
        : { allowed: false, reason: "sign-in-required" };

    case "approved_bidders": {
      if (viewer.kind !== "bidder") return { allowed: false, reason: "sign-in-required" };

      /*
       * "Approved" means at least one approval row that is actually
       * approved. A user may have several — a rejection followed by a
       * later approval — so this asks the question rather than reading
       * the most recent row and hoping.
       */
      const approved = await prisma.bidderApproval.count({
        where: { userId: viewer.userId, status: "approved" },
      });

      return approved > 0
        ? { allowed: true }
        : { allowed: false, reason: "approval-required" };
    }
  }
}

/** Documents a viewer may see listed. Listing is itself a disclosure. */
export function visibilitiesFor(viewer: Viewer): DocumentVisibility[] {
  if (viewer.kind === "admin") return ["public", "registered", "approved_bidders"];
  if (viewer.kind === "bidder") return ["public", "registered", "approved_bidders"];
  return ["public"];
}
