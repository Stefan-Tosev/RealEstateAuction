import type { DocumentKind, LotStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  publishChecklistApplies,
  canTransition,
  publishBlockers,
  publishWarnings,
} from "@/server/catalogue/publish";

const soon = (days: number) => new Date(Date.now() + days * 86_400_000);

function ready() {
  return {
    reserveAgreedBy: "admin-id",
    imageCount: 2,
    previewStartsAt: soon(1),
    biddingOpensAt: soon(22),
    scheduledCloseAt: soon(27),
    // A complete pack. Completeness only — the check never looks inside.
    documentKinds: ["title_deed", "encumbrances"] as DocumentKind[],
    sellerId: "seller-id",
  };
}

describe("publishBlockers", () => {
  it("passes a lot that is genuinely ready", () => {
    expect(publishBlockers(ready())).toEqual([]);
  });

  it("blocks a lot whose reserve nobody agreed", () => {
    /*
     * architecture §10, stated as a hard rule: "Model this as a
     * reserve_agreed_by / reserve_agreed_at pair on lots. If it is null,
     * the lot cannot be published."
     */
    const blockers = publishBlockers({ ...ready(), reserveAgreedBy: null });
    expect(blockers.map((b) => b.code)).toContain("no-reserve-agreed");
  });

  it("blocks a lot with no photographs", () => {
    const blockers = publishBlockers({ ...ready(), imageCount: 0 });
    expect(blockers.map((b) => b.code)).toContain("no-images");
  });

  it("blocks a lot with no dates", () => {
    const blockers = publishBlockers({
      ...ready(),
      biddingOpensAt: null,
      scheduledCloseAt: null,
    });
    expect(blockers.map((b) => b.code)).toContain("no-dates");
  });

  it("blocks a close that precedes the opening", () => {
    const blockers = publishBlockers({
      ...ready(),
      biddingOpensAt: soon(27),
      scheduledCloseAt: soon(22),
    });
    expect(blockers.map((b) => b.code)).toContain("bad-date-order");
  });

  it("blocks a preview that starts after bidding opens", () => {
    const blockers = publishBlockers({
      ...ready(),
      previewStartsAt: soon(25),
      biddingOpensAt: soon(22),
    });
    expect(blockers.map((b) => b.code)).toContain("bad-date-order");
  });

  it("reports every blocker at once, not just the first", () => {
    // Fixing one problem at a time and re-submitting is a miserable way
    // to work.
    const blockers = publishBlockers({
      reserveAgreedBy: null,
      imageCount: 0,
      previewStartsAt: null,
      biddingOpensAt: null,
      scheduledCloseAt: null,
      documentKinds: [],
      sellerId: null,
    });
    expect(blockers.map((b) => b.code).sort()).toEqual([
      "legal-pack-incomplete",
      "no-dates",
      "no-images",
      "no-reserve-agreed",
      "no-seller",
    ]);
  });
});

describe("canTransition", () => {
  it("allows a draft to be published or cancelled", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
  });

  it("allows unpublishing while nobody can have bid", () => {
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(true);
  });

  it("refuses hand-driving the bidding lifecycle", () => {
    /*
     * BIDDING_OPEN -> EXTENDING -> CLOSED_* belong to the soft-close
     * engine. A human moving a lot out of EXTENDING mid-auction would
     * break the anti-snipe guarantee bidders were promised.
     */
    expect(canTransition("BIDDING_OPEN", "CLOSED_SOLD")).toBe(false);
    expect(canTransition("EXTENDING", "CLOSED_SOLD")).toBe(false);
    expect(canTransition("BIDDING_OPEN", "DRAFT")).toBe(false);
    expect(allowedTransitions("EXTENDING")).toEqual([]);
  });

  it("refuses reopening a finished lot", () => {
    for (const from of ["CLOSED_SOLD", "CLOSED_UNSOLD"] as LotStatus[]) {
      expect(allowedTransitions(from)).toEqual([]);
    }
  });

  it("leaves an unmet reserve a way out", () => {
    /*
     * §10: "An unmet reserve is not a terminal state." It used to be one
     * here — an empty list — which stranded the single ending that has a
     * verified buyer with money already down.
     */
    expect(allowedTransitions("RESERVE_NOT_MET")).toEqual(["CLOSED_SOLD", "CLOSED_UNSOLD"]);
  });

  it("permits cancelling a live lot", () => {
    // Withdrawal is a real commercial event, with a fee attached (§10).
    expect(canTransition("BIDDING_OPEN", "CANCELLED")).toBe(true);
  });

  it("covers every status, so a new one cannot be silently unhandled", () => {
    const all: LotStatus[] = [
      "DRAFT",
      "PUBLISHED",
      "BIDDING_OPEN",
      "EXTENDING",
      "RESERVE_NOT_MET",
      "CLOSED_SOLD",
      "CLOSED_UNSOLD",
      "CANCELLED",
    ];
    for (const status of all) expect(Array.isArray(allowedTransitions(status))).toBe(true);
  });
});

describe("the legal pack gate", () => {
  /*
   * Completeness, never correctness. Whether a document is present is an
   * administrative fact; whether the title is good is a legal opinion,
   * and giving one takes on liability for defects in title on a
   * six-figure transaction. The seller's solicitor prepares the pack and
   * the seller warrants it; the house publishes it as agent.
   */
  it("refuses to publish without the two documents a bidder needs to decide", () => {
    for (const kinds of [[], ["title_deed"], ["encumbrances"]] as DocumentKind[][]) {
      const blockers = publishBlockers({ ...ready(), documentKinds: kinds });
      expect(blockers.map((b) => b.code), JSON.stringify(kinds)).toContain(
        "legal-pack-incomplete",
      );
    }
  });

  it("names what is missing, in both languages an operator will hear it in", () => {
    const [blocker] = publishBlockers({ ...ready(), documentKinds: ["title_deed"] });
    expect(blocker.message).toContain("encumbrances certificate");
    expect(blocker.message).toContain("удостоверение за тежести");
  });

  it("publishes once both are there, whatever else the pack holds", () => {
    const blockers = publishBlockers({
      ...ready(),
      documentKinds: ["title_deed", "encumbrances", "other"],
    });
    expect(blockers).toEqual([]);
  });

  it("warns about the transfer documents rather than blocking on them", () => {
    /*
     * A notary will want these before completion, but they have until
     * completion to arrive. Blocking a sale over paperwork that is not
     * needed to decide would hold up the sale for no protection.
     */
    const warnings = publishWarnings({ documentKinds: ["title_deed", "encumbrances"] });
    expect(warnings.map((w) => w.code)).toEqual(["legal-pack-thin"]);
    expect(warnings[0].message).toContain("Not required to publish");

    // And says nothing once the pack is full.
    expect(
      publishWarnings({
        documentKinds: ["title_deed", "encumbrances", "sketch", "tax_valuation"],
      }),
    ).toEqual([]);
  });
});

describe("the seller gate", () => {
  it("refuses to publish a lot whose owner nobody recorded", () => {
    /*
     * A live lot with no seller has nobody to telephone when it closes
     * below reserve, nobody to bill the commission to, and nobody to
     * send the bid log. §11 keeps sourcing admin-curated, so somebody
     * has to have entered the record.
     */
    const blockers = publishBlockers({ ...ready(), sellerId: null });
    expect(blockers.map((b) => b.code)).toContain("no-seller");
  });

  it("publishes once the seller is attached", () => {
    expect(publishBlockers({ ...ready(), sellerId: "a-seller" })).toEqual([]);
  });
});

describe("whether the publish checklist applies", () => {
  it("applies wherever publishing is still the next step", () => {
    expect(publishChecklistApplies("DRAFT")).toBe(true);
    // Live, but recallable to draft, so a blocker appearing now matters.
    expect(publishChecklistApplies("PUBLISHED")).toBe(true);
    // Withdrawn; its only way out is back to DRAFT.
    expect(publishChecklistApplies("CANCELLED")).toBe(true);
  });

  it("does not apply once bidding has started or the lot has finished", () => {
    for (const status of [
      "BIDDING_OPEN",
      "EXTENDING",
      "RESERVE_NOT_MET",
      "CLOSED_SOLD",
      "CLOSED_UNSOLD",
    ] as LotStatus[]) {
      expect(publishChecklistApplies(status), status).toBe(false);
    }
  });

  it("does not follow the cancel-and-redraft recovery route", () => {
    /*
     * The regression this replaced. PUBLISHED really is reachable from
     * BIDDING_OPEN — cancel the live lot, return it to draft, publish it
     * again — so deriving this by walking ALLOWED_TRANSITIONS declared a
     * lot people are actively bidding on "still publishable".
     */
    expect(canTransition("BIDDING_OPEN", "CANCELLED")).toBe(true);
    expect(canTransition("CANCELLED", "DRAFT")).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(true);
    expect(publishChecklistApplies("BIDDING_OPEN")).toBe(false);
  });

  it("answers for every status, so a new one cannot slip through", () => {
    const every: LotStatus[] = [
      "DRAFT",
      "PUBLISHED",
      "BIDDING_OPEN",
      "EXTENDING",
      "RESERVE_NOT_MET",
      "CLOSED_SOLD",
      "CLOSED_UNSOLD",
      "CANCELLED",
    ];
    for (const status of every) {
      expect(typeof publishChecklistApplies(status), status).toBe("boolean");
    }
  });
});
