import type { LotStatus } from "@prisma/client";

/*
 * What has to be true before a lot can go live, and which status
 * transitions an operator is allowed to make.
 *
 * Kept pure and separate from the mutation so the rules can be tested
 * without a database, and so the form can show them as warnings before
 * anyone presses the button.
 */

export type PublishBlocker = {
  code: "no-reserve-agreed" | "no-images" | "no-dates" | "bad-date-order";
  message: string;
};

type PublishCandidate = {
  reserveAgreedBy: string | null;
  imageCount: number;
  previewStartsAt: Date | null;
  biddingOpensAt: Date | null;
  scheduledCloseAt: Date | null;
};

/**
 * Reasons this lot cannot be published. Empty means it can.
 *
 * Returns all of them rather than the first, because an operator fixing
 * one blocker at a time and re-submitting is a miserable way to work.
 */
export function publishBlockers(lot: PublishCandidate): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  /*
   * docs/architecture.md §10, stated as a hard rule: "Model this as a
   * reserve_agreed_by / reserve_agreed_at pair on lots. If it is null,
   * the lot cannot be published." The auctioneer agrees the reserve;
   * sellers do not set it unilaterally.
   */
  if (!lot.reserveAgreedBy) {
    blockers.push({
      code: "no-reserve-agreed",
      message: "An auctioneer must agree the reserve before this lot can be published.",
    });
  }

  // A listing with no photograph is not a listing anyone will act on,
  // and the public catalogue would fall back to an abstract gradient.
  if (lot.imageCount === 0) {
    blockers.push({
      code: "no-images",
      message: "Add at least one photograph of the property.",
    });
  }

  if (!lot.biddingOpensAt || !lot.scheduledCloseAt) {
    blockers.push({
      code: "no-dates",
      message: "Set when bidding opens and when the lot is scheduled to close.",
    });
  } else if (lot.scheduledCloseAt <= lot.biddingOpensAt) {
    blockers.push({
      code: "bad-date-order",
      message: "The scheduled close must be after bidding opens.",
    });
  } else if (lot.previewStartsAt && lot.previewStartsAt >= lot.biddingOpensAt) {
    blockers.push({
      code: "bad-date-order",
      message: "The preview must start before bidding opens.",
    });
  }

  return blockers;
}

/*
 * Transitions an operator may make by hand.
 *
 * Deliberately narrow. BIDDING_OPEN -> EXTENDING -> CLOSED_* belong to
 * the soft-close engine (Phase 3), not to a person with a dropdown:
 * a human moving a lot out of EXTENDING mid-auction would break the
 * anti-snipe guarantee bidders were promised.
 */
const ALLOWED_TRANSITIONS: Record<LotStatus, LotStatus[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  // Unpublishing back to draft is allowed while nobody can have bid yet.
  PUBLISHED: ["DRAFT", "CANCELLED"],
  BIDDING_OPEN: ["CANCELLED"],
  EXTENDING: [],
  RESERVE_NOT_MET: [],
  CLOSED_SOLD: [],
  CLOSED_UNSOLD: [],
  CANCELLED: ["DRAFT"],
};

export function canTransition(from: LotStatus, to: LotStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: LotStatus): LotStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
