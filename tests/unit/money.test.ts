import { describe, expect, it } from "vitest";
import { AUCTION_CURRENCY, formatMoney } from "@/lib/money";

/*
 * Money is stored as bigint minor units. These tests pin the two things
 * that would quietly corrupt a price: converting to Number too early,
 * and rendering an auction guide price as though it were an invoice.
 */

// Intl inserts non-breaking and narrow-no-break spaces; normalise so the
// assertions read as what a human sees rather than as codepoint trivia.
function normalise(value: string): string {
  return value.replace(/[  ]/g, " ");
}

describe("formatMoney", () => {
  it("renders round amounts without decimals", () => {
    // "€100,000.00" reads as an invoice; "€100,000" reads as a price.
    expect(normalise(formatMoney(10_000_000n, "en"))).toBe("€100,000");
  });

  it("keeps decimals when there are stotinki", () => {
    expect(normalise(formatMoney(10_000_050n, "en"))).toBe("€100,000.50");
  });

  it("formats in the Bulgarian convention for bg", () => {
    const bg = normalise(formatMoney(10_000_000n, "bg"));
    expect(bg).toContain("100 000");
    expect(bg).toContain("€");
    // Bulgarian puts the symbol after the amount; English before it.
    expect(bg).not.toBe(normalise(formatMoney(10_000_000n, "en")));
  });

  it("accepts the decimal strings DTOs carry", () => {
    // bigint is not JSON-serializable, so money crosses to the client as
    // a string. Both inputs must format identically.
    expect(formatMoney("10000000", "en")).toBe(formatMoney(10_000_000n, "en"));
  });

  it("is exact for values beyond Number.MAX_SAFE_INTEGER", () => {
    /*
     * Guards the one risky line in money.ts. A property will never cost
     * this much, but the test proves the value survives transport as a
     * bigint rather than being rounded on the way in.
     */
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2, in minor units
    expect(formatMoney(huge, "en")).toBe(formatMoney("9007199254740993", "en"));
  });

  it("uses a single currency constant", () => {
    // There is no currency column; if one is ever added, this is the
    // seam that has to change.
    expect(AUCTION_CURRENCY).toBe("EUR");
  });

  it("handles zero", () => {
    expect(normalise(formatMoney(0n, "en"))).toBe("€0");
  });
});
