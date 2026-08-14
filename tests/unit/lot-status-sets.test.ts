import { LotStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { keysWhere } from "@/lib/exhaustive";
import { LIVE_STATUSES } from "@/server/auction/live-lots";
import { publishChecklistApplies } from "@/server/catalogue/publish";
import {
  DETAIL_VISIBLE_LOT_STATUSES,
  isPubliclyVisible,
  LISTABLE_LOT_STATUSES,
} from "@/server/catalogue/statuses";

/*
 * The status sets, asserted by contents.
 *
 * These are all Records keyed by LotStatus, so a *new* status cannot be
 * forgotten — it is a compile error until somebody classifies it, which
 * is verified by adding one to the enum and watching tsc fail, not here.
 *
 * What the compiler cannot see is a boolean set the wrong way round. The
 * key and the value both look plausible, nothing fails to build, and a
 * lot silently drops out of the public index. So the memberships are
 * spelled out once, in full, as data.
 */

const ALL: LotStatus[] = Object.values(LotStatus);

describe("the lot status sets", () => {
  it("covers every status the schema defines", () => {
    // Guards the premise of every other test here: if the enum grows and
    // this file is not revisited, say so.
    expect(ALL.sort()).toEqual(
      [
        "BIDDING_OPEN",
        "CANCELLED",
        "CLOSED_SOLD",
        "CLOSED_UNSOLD",
        "DRAFT",
        "EXTENDING",
        "PUBLISHED",
        "RESERVE_NOT_MET",
      ].sort(),
    );
  });

  it("lists only lots that are live or awaiting their auction", () => {
    expect([...LISTABLE_LOT_STATUSES].sort()).toEqual(
      ["BIDDING_OPEN", "EXTENDING", "PUBLISHED"].sort(),
    );
  });

  it("keeps finished lots reachable by URL after they leave the index", () => {
    /*
     * The superset relationship is the point: a shared or indexed URL
     * must not start 404-ing because the auction ended.
     */
    for (const status of LISTABLE_LOT_STATUSES) {
      expect(DETAIL_VISIBLE_LOT_STATUSES).toContain(status);
    }

    expect([...DETAIL_VISIBLE_LOT_STATUSES].sort()).toEqual(
      [
        "BIDDING_OPEN",
        "CLOSED_SOLD",
        "CLOSED_UNSOLD",
        "EXTENDING",
        "PUBLISHED",
        "RESERVE_NOT_MET",
      ].sort(),
    );
  });

  it("resolves DRAFT and CANCELLED nowhere at all", () => {
    // The two that must stay invisible: one is unfinished work, the
    // other was withdrawn, and neither is the public's business.
    expect(isPubliclyVisible("DRAFT")).toBe(false);
    expect(isPubliclyVisible("CANCELLED")).toBe(false);
    expect(isPubliclyVisible("PUBLISHED")).toBe(true);
    expect(isPubliclyVisible("CLOSED_SOLD")).toBe(true);
  });

  it("counts only the two mid-auction statuses as live", () => {
    expect([...LIVE_STATUSES].sort()).toEqual(["BIDDING_OPEN", "EXTENDING"].sort());
  });

  it("applies the publish checklist only before bidding starts", () => {
    expect(ALL.filter(publishChecklistApplies).sort()).toEqual(
      ["CANCELLED", "DRAFT", "PUBLISHED"].sort(),
    );
  });

  it("never calls a lot both live and still publishable", () => {
    /*
     * The invariant the reachability bug broke. It is not enough that
     * each set is individually right — publishing advice on a lot people
     * are bidding on is the contradiction that started this.
     */
    for (const status of LIVE_STATUSES) {
      expect(publishChecklistApplies(status)).toBe(false);
    }
  });
});

describe("keysWhere", () => {
  it("returns the keys mapped to true and drops the rest", () => {
    expect(keysWhere({ a: true, b: false, c: true }).sort()).toEqual(["a", "c"]);
  });

  it("returns an empty array rather than undefined when nothing matches", () => {
    expect(keysWhere({ a: false, b: false })).toEqual([]);
  });
});
