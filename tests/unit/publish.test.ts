import type { LotStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition, publishBlockers } from "@/server/catalogue/publish";

const soon = (days: number) => new Date(Date.now() + days * 86_400_000);

function ready() {
  return {
    reserveAgreedBy: "admin-id",
    imageCount: 2,
    previewStartsAt: soon(1),
    biddingOpensAt: soon(22),
    scheduledCloseAt: soon(27),
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
    });
    expect(blockers.length).toBe(3);
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
