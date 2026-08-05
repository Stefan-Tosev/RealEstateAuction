import { describe, expect, it } from "vitest";
import { AUCTION_CURRENCY, formatMoney, parseMoneyInput } from "@/lib/money";

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

describe("reading an amount someone typed", () => {
  /*
   * The case this function exists for. formatMoney renders €345,000.50
   * as "345 000,50 €" in Bulgarian; the old parsers stripped commas as
   * group separators, so a bidder typing back what the site had just
   * shown them bid €34,500,050 — and it passed every downstream check,
   * because it is comfortably above the minimum.
   */
  it("reads the Bulgarian form of the number the site itself printed", () => {
    // Intl groups with a non-breaking space, which is exactly the
    // character a copy-paste brings back into the field.
    expect(formatMoney(34_500_050n, "bg")).toBe("345 000,50 €");
    expect(parseMoneyInput("345 000,50 €")).toBe(34_500_050n);
    expect(parseMoneyInput("345 000,50 €")).toBe(34_500_050n);
    expect(parseMoneyInput("345 000,50")).toBe(34_500_050n);
    expect(parseMoneyInput("345000,50")).toBe(34_500_050n);
  });

  it("reads the English form too", () => {
    expect(parseMoneyInput("345,000.50")).toBe(34_500_050n);
    expect(parseMoneyInput("345 000.50")).toBe(34_500_050n);
    expect(parseMoneyInput("345000.50")).toBe(34_500_050n);
  });

  it("takes the later separator as the decimal point when both appear", () => {
    expect(parseMoneyInput("1.234,56")).toBe(123_456n);
    expect(parseMoneyInput("1,234.56")).toBe(123_456n);
  });

  it("treats three digits after a lone separator as grouping", () => {
    // The one ambiguous case. Grouping is both conventions' reading, and
    // three decimal places is not a valid amount of money.
    expect(parseMoneyInput("345,000")).toBe(34_500_000n);
    expect(parseMoneyInput("345.000")).toBe(34_500_000n);
    expect(parseMoneyInput("1,234,567")).toBe(123_456_700n);
  });

  it("keeps one and two decimal places apart from grouping", () => {
    expect(parseMoneyInput("345,5")).toBe(34_550n);
    expect(parseMoneyInput("345.5")).toBe(34_550n);
    expect(parseMoneyInput("345,05")).toBe(34_505n);
  });

  it("ignores spaces of every kind, and the currency", () => {
    expect(parseMoneyInput("\u00a0100\u202f000\u00a0€\u00a0")).toBe(10_000_000n);
    expect(parseMoneyInput("EUR 100000")).toBe(10_000_000n);
    expect(parseMoneyInput("100 000 лв.")).toBe(10_000_000n);
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const input of ["", "   ", "abc", "1.2345", "345,", "1e5", "-100", "10 000$x", "."]) {
      expect(parseMoneyInput(input)).toBeNull();
    }
  });

  it("survives amounts past the safe-integer range", () => {
    // bigint the whole way, so this is exact rather than nearly right.
    expect(parseMoneyInput("999999999999999999.99")).toBe(99_999_999_999_999_999_999n);
  });

  it("round-trips whatever formatMoney printed, in both locales", () => {
    for (const minor of [1n, 99n, 100n, 25_000n, 10_000_000n, 34_500_050n, 89_000_000n]) {
      for (const locale of ["bg", "en"] as const) {
        expect(parseMoneyInput(formatMoney(minor, locale))).toBe(minor);
      }
    }
  });
});
