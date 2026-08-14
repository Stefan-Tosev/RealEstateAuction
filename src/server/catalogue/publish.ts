import type { DocumentKind, LotStatus } from "@prisma/client";

/*
 * What has to be true before a lot can go live, and which status
 * transitions an operator is allowed to make.
 *
 * Kept pure and separate from the mutation so the rules can be tested
 * without a database, and so the form can show them as warnings before
 * anyone presses the button.
 */

export type PublishBlocker = {
  code:
    | "no-reserve-agreed"
    | "no-images"
    | "no-dates"
    | "bad-date-order"
    | "legal-pack-incomplete"
    | "no-seller";
  message: string;
};

/** Advisory only: worth saying, not worth blocking a publish over. */
export type PublishWarning = { code: "legal-pack-thin"; message: string };

/*
 * The legal pack, checked for COMPLETENESS and never for correctness.
 *
 * That distinction is the whole of the auction house's position. Whether
 * a document is present is an administrative fact anyone can verify;
 * whether the title is good is a legal opinion, and giving one takes on
 * liability for defects in title on a six-figure transaction. The
 * seller's solicitor prepares the pack and the seller warrants it; the
 * house publishes it as agent, with no warranty; in Bulgaria the нотариус
 * verifies title at transfer and carries statutory responsibility for the
 * deed.
 *
 * So: refuse to publish a pack that is missing something a bidder needs
 * in order to decide. Never assert that what is there is sound.
 */

/** A bidder cannot sensibly decide without these two. */
export const REQUIRED_DOCUMENT_KINDS: DocumentKind[] = ["title_deed", "encumbrances"];

/*
 * Needed for the transfer rather than for the decision, so their absence
 * is worth flagging to an operator and not worth stopping a sale over.
 */
export const EXPECTED_DOCUMENT_KINDS: DocumentKind[] = ["sketch", "tax_valuation"];

const DOCUMENT_LABEL: Record<string, string> = {
  title_deed: "title deed (нотариален акт)",
  encumbrances: "encumbrances certificate (удостоверение за тежести)",
  sketch: "sketch (скица)",
  tax_valuation: "tax valuation (данъчна оценка)",
};

function label(kind: DocumentKind): string {
  return DOCUMENT_LABEL[kind] ?? kind;
}

type PublishCandidate = {
  reserveAgreedBy: string | null;
  imageCount: number;
  previewStartsAt: Date | null;
  biddingOpensAt: Date | null;
  scheduledCloseAt: Date | null;
  documentKinds: DocumentKind[];
  sellerId: string | null;
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

  /*
   * Nobody to telephone when the lot closes below reserve, nobody to bill
   * the commission to, and nobody to send the bid log. §11 keeps sourcing
   * admin-curated, so this is a record somebody has to have entered — and
   * a live lot whose owner is unknown is not a listing, it is a gap.
   */
  if (!lot.sellerId) {
    blockers.push({
      code: "no-seller",
      message: "Attach the seller before publishing. A live lot needs an owner to contact and bill.",
    });
  }

  /*
   * A lot published with an empty legal pack asks people to bid on a
   * property they cannot investigate. The check is on presence only —
   * see the note above on why it must never be on content.
   */
  const missing = REQUIRED_DOCUMENT_KINDS.filter((kind) => !lot.documentKinds.includes(kind));
  if (missing.length > 0) {
    blockers.push({
      code: "legal-pack-incomplete",
      message: `The legal pack is missing the ${missing.map(label).join(" and the ")}. Bidders need these to decide.`,
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
  /*
   * §10's negotiation window. Not a dead end any more — these two are
   * the whole point of the status. Driven by src/server/auction/
   * negotiation.ts rather than by the generic transition form, because
   * each carries deposit consequences the form knows nothing about.
   */
  RESERVE_NOT_MET: ["CLOSED_SOLD", "CLOSED_UNSOLD"],
  CLOSED_SOLD: [],
  CLOSED_UNSOLD: [],
  CANCELLED: ["DRAFT"],
};

export function canTransition(from: LotStatus, to: LotStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/*
 * Whether the publish checklist still has anything useful to say.
 *
 * Publish blockers are pre-flight advice about getting a lot live. Once
 * bidding has started or the lot has finished they are noise on a page
 * somebody opened for a different reason — a CLOSED_SOLD lot announcing
 * that no auctioneer agreed its reserve is answering a question nobody
 * asked.
 *
 * NOT derived by walking ALLOWED_TRANSITIONS, though that was the first
 * attempt. PUBLISHED genuinely is reachable from BIDDING_OPEN — cancel
 * the live lot, return it to draft, publish it again — so a reachability
 * walk calls a lot people are actively bidding on "still publishable".
 * That path is a recovery route, not a reason to show a checklist.
 *
 * A Record rather than a list, so a new LotStatus is a compile error
 * here instead of a silently wrong answer.
 */
const CHECKLIST_APPLIES: Record<LotStatus, boolean> = {
  DRAFT: true,
  // Live, but still recallable to draft. A blocker that appears now — a
  // photograph deleted, the seller detached — is worth showing.
  PUBLISHED: true,
  // Withdrawn, and its only way out is back to DRAFT, so the checklist
  // is forward-looking again.
  CANCELLED: true,

  // Bidding has started, or it is over. Publishing is behind this lot.
  BIDDING_OPEN: false,
  EXTENDING: false,
  RESERVE_NOT_MET: false,
  CLOSED_SOLD: false,
  CLOSED_UNSOLD: false,
};

export function publishChecklistApplies(status: LotStatus): boolean {
  return CHECKLIST_APPLIES[status];
}

export function allowedTransitions(from: LotStatus): LotStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Worth telling an operator, but not worth refusing a publish over.
 *
 * These documents matter for the transfer rather than for the decision to
 * bid, and a notary will require them regardless. Blocking on them would
 * hold up a sale over paperwork that has until completion to arrive.
 */
export function publishWarnings(lot: Pick<PublishCandidate, "documentKinds">): PublishWarning[] {
  const missing = EXPECTED_DOCUMENT_KINDS.filter((kind) => !lot.documentKinds.includes(kind));
  if (missing.length === 0) return [];

  return [
    {
      code: "legal-pack-thin",
      message: `No ${missing.map(label).join(" and no ")} in the pack yet. Not required to publish; the notary will want them before transfer.`,
    },
  ];
}
