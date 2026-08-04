import type { LotStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { derivePhase } from "@/server/catalogue/phase";

/*
 * derivePhase is where docs/architecture.md §1 lives: PUBLISHED is a
 * preview with no bidding, BIDDING_OPEN and EXTENDING are the bidding
 * window, and the two count down to different columns.
 */

const OPENS = new Date("2026-09-01T09:00:00Z");
const CLOSES = new Date("2026-09-06T09:00:00Z");
const CLOSED = new Date("2026-08-01T09:00:00Z");

function lot(status: LotStatus, overrides: Partial<Parameters<typeof derivePhase>[0]> = {}) {
  return {
    status,
    biddingOpensAt: OPENS,
    effectiveCloseAt: CLOSES,
    closedAt: CLOSED,
    ...overrides,
  };
}

describe("derivePhase", () => {
  it("puts PUBLISHED in preview, counting down to bidding opening", () => {
    const phase = derivePhase(lot("PUBLISHED"), "bg");

    // The assertion that matters: a preview lot must never be given the
    // bidding phase, or the UI would offer a bid affordance during the
    // 21-day preview window.
    expect(phase.kind).toBe("preview");
    if (phase.kind !== "preview") throw new Error("unreachable");
    expect(phase.targetIso).toBe(OPENS.toISOString());
  });

  it.each(["BIDDING_OPEN", "EXTENDING"] as const)(
    "puts %s in the bidding phase, counting down to the effective close",
    (status) => {
      const phase = derivePhase(lot(status), "bg");

      expect(phase.kind).toBe("bidding");
      if (phase.kind !== "bidding") throw new Error("unreachable");
      // effective_close_at, not scheduled_close_at — the former moves on
      // soft close and is the authoritative one.
      expect(phase.targetIso).toBe(CLOSES.toISOString());
    },
  );

  it.each([
    "RESERVE_NOT_MET",
    "CLOSED_SOLD",
    "CLOSED_UNSOLD",
    "CANCELLED",
    "DRAFT",
  ] as const)("treats %s as closed", (status) => {
    expect(derivePhase(lot(status), "bg").kind).toBe("closed");
  });

  it("falls back to scheduled when a published lot has no opening date", () => {
    expect(derivePhase(lot("PUBLISHED", { biddingOpensAt: null }), "bg").kind).toBe("scheduled");
  });

  it("falls back to scheduled when a bidding lot has no close date", () => {
    expect(derivePhase(lot("BIDDING_OPEN", { effectiveCloseAt: null }), "bg").kind).toBe(
      "scheduled",
    );
  });

  it("does not depend on the current clock", () => {
    /*
     * The stored status is authoritative — the soft-close engine owns
     * transitions. A page that re-derived the phase by comparing
     * timestamps to now() would disagree with the engine in the seconds
     * around a close, which is exactly when being wrong matters.
     */
    const past = derivePhase(
      lot("BIDDING_OPEN", { effectiveCloseAt: new Date("2000-01-01T00:00:00Z") }),
      "bg",
    );
    expect(past.kind).toBe("bidding");
  });

  it("formats the closed date in the page locale", () => {
    const bg = derivePhase(lot("CLOSED_SOLD"), "bg");
    const en = derivePhase(lot("CLOSED_SOLD"), "en");
    if (bg.kind !== "closed" || en.kind !== "closed") throw new Error("unreachable");

    expect(bg.closedAtFormatted).not.toBeNull();
    expect(bg.closedAtFormatted).not.toBe(en.closedAtFormatted);
  });

  it("tolerates a closed lot with no closedAt", () => {
    const phase = derivePhase(lot("CLOSED_UNSOLD", { closedAt: null }), "bg");
    if (phase.kind !== "closed") throw new Error("unreachable");
    expect(phase.closedAtFormatted).toBeNull();
  });
});
