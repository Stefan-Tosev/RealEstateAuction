import type { LotStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { liveLotSignals, RUNNING_LONG_MS } from "@/server/auction/live-lots";

/*
 * docs/open-items.md §3.4. Extension is uncapped by design, so these are
 * the signals that tell an auctioneer which lots have run away from their
 * schedule — and which are not closing at all.
 */

const now = new Date("2026-08-14T18:00:00Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

function lot(overrides: Partial<Parameters<typeof liveLotSignals>[0]> = {}) {
  return {
    status: "BIDDING_OPEN" as LotStatus,
    extensionCount: 0,
    scheduledCloseAt: at(10 * 60_000),
    effectiveCloseAt: at(10 * 60_000),
    ...overrides,
  };
}

describe("liveLotSignals", () => {
  it("reports a lot running to schedule as unremarkable", () => {
    const signals = liveLotSignals(lot(), now);
    expect(signals).toMatchObject({
      extending: false,
      extensionCount: 0,
      overrunMs: 0,
      runningLong: false,
      overdue: false,
    });
    expect(signals.closesInMs).toBe(10 * 60_000);
  });

  it("measures overrun against the scheduled close, not the last extension", () => {
    /*
     * The question is "how far past its advertised end is this?" — each
     * extension on its own only ever answers "five more minutes".
     */
    const signals = liveLotSignals(
      lot({
        status: "EXTENDING",
        extensionCount: 9,
        scheduledCloseAt: at(-45 * 60_000),
        effectiveCloseAt: at(5 * 60_000),
      }),
      now,
    );

    expect(signals.extending).toBe(true);
    expect(signals.extensionCount).toBe(9);
    expect(signals.overrunMs).toBe(50 * 60_000);
    expect(signals.runningLong).toBe(true);
  });

  it("does not cry wolf over a lot contested at the wire", () => {
    // Just under the threshold: genuinely close bidding, not a runaway.
    const signals = liveLotSignals(
      lot({
        status: "EXTENDING",
        extensionCount: 3,
        scheduledCloseAt: at(-20 * 60_000),
        effectiveCloseAt: at(RUNNING_LONG_MS - 20 * 60_000 - 60_000),
      }),
      now,
    );
    expect(signals.runningLong).toBe(false);
  });

  it("flags a lot that is past its close and still open", () => {
    /*
     * Not an auction signal at all — it means nothing is closing lots,
     * which is almost always the worker being down. Invisible until now
     * except as "why did that lot never end?".
     */
    const signals = liveLotSignals(
      lot({ scheduledCloseAt: at(-10 * 60_000), effectiveCloseAt: at(-10 * 60_000) }),
      now,
    );
    expect(signals.overdue).toBe(true);
    expect(signals.closesInMs).toBe(-10 * 60_000);
  });

  it("allows a grace period so the worker's own interval is not an alarm", () => {
    // A few seconds past close is normal: the worker runs every 5s.
    const signals = liveLotSignals(
      lot({ scheduledCloseAt: at(-5_000), effectiveCloseAt: at(-5_000) }),
      now,
    );
    expect(signals.overdue).toBe(false);
  });

  it("never reports negative overrun for a close brought forward", () => {
    // Should not happen, but a negative "past schedule" column would be
    // read as a countdown and mean the opposite of what it said.
    const signals = liveLotSignals(
      lot({ scheduledCloseAt: at(20 * 60_000), effectiveCloseAt: at(10 * 60_000) }),
      now,
    );
    expect(signals.overrunMs).toBe(0);
    expect(signals.runningLong).toBe(false);
  });

  it("copes with a lot that has no dates set", () => {
    const signals = liveLotSignals(
      lot({ scheduledCloseAt: null, effectiveCloseAt: null }),
      now,
    );
    expect(signals.overrunMs).toBe(0);
    expect(signals.closesInMs).toBeNull();
    // Unknown is not overdue: an alert nobody can act on is noise.
    expect(signals.overdue).toBe(false);
  });
});
