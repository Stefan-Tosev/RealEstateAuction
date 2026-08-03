import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, SOFIA_TZ } from "@/lib/datetime";

/*
 * Timestamps are stored in UTC and displayed in Europe/Sofia
 * (docs/architecture.md §2). vitest.config.ts pins TZ=UTC so these
 * assertions mean something — on a machine already set to Sofia, a test
 * that "passes" would prove nothing.
 */

describe("formatDateTime", () => {
  it("renders in Sofia time, not UTC", () => {
    // 09:00 UTC in July is 12:00 in Sofia (EEST, UTC+3).
    expect(formatDateTime("2026-07-15T09:00:00Z", "en")).toContain("12:00");
  });

  it("tracks the summer/winter offset change", () => {
    /*
     * Bulgaria is UTC+3 in summer (EEST) and UTC+2 in winter (EET). The
     * same wall-clock UTC instant must therefore render an hour apart
     * across the DST boundary — the check that catches a hardcoded
     * "+2" or a fixed-offset shortcut.
     */
    const summer = formatDateTime("2026-07-15T09:00:00Z", "en");
    const winter = formatDateTime("2026-01-15T09:00:00Z", "en");

    expect(summer).toContain("12:00");
    expect(winter).toContain("11:00");
  });

  it("accepts a Date as well as an ISO string", () => {
    const iso = "2026-07-15T09:00:00Z";
    expect(formatDateTime(new Date(iso), "en")).toBe(formatDateTime(iso, "en"));
  });

  it("differs by locale", () => {
    const iso = "2026-07-15T09:00:00Z";
    expect(formatDateTime(iso, "bg")).not.toBe(formatDateTime(iso, "en"));
  });

  it("names the timezone Europe/Sofia", () => {
    expect(SOFIA_TZ).toBe("Europe/Sofia");
  });
});

describe("formatDate", () => {
  it("omits the time", () => {
    expect(formatDate("2026-07-15T09:00:00Z", "en")).not.toMatch(/\d{2}:\d{2}/);
  });

  it("uses the Sofia date, which can differ from the UTC date", () => {
    // 22:30 UTC on the 14th is already 01:30 on the 15th in Sofia.
    expect(formatDate("2026-07-14T22:30:00Z", "en")).toContain("15");
  });
});
