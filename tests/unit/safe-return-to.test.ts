import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/safe-return-to";

/*
 * The open-redirect guard on the terms acceptance page.
 *
 * That page is exactly what a bidder gets linked to from an email about
 * changed terms, which is the same shape as the phishing message that
 * would abuse a returnTo taken at face value.
 */
describe("safeReturnTo", () => {
  it("keeps a path under the current locale", () => {
    expect(safeReturnTo("/bg/lots/sofia-flat", "bg")).toBe("/bg/lots/sofia-flat");
  });

  it("falls back when there is nothing to return to", () => {
    expect(safeReturnTo(undefined, "bg")).toBe("/bg/lots");
  });

  it.each([
    ["//evil.example/steal", "protocol-relative — absolute despite the leading slash"],
    ["/\evil.example", "a backslash is read as a slash by every major engine"],
    ["https://evil.example", "plainly absolute"],
    ["http://evil.example", "plainly absolute"],
    ["/en/lots", "another locale — outside what this page is showing"],
    ["lots", "relative, so it would resolve against the current path"],
    ["/bg", "the locale root without a trailing slash, so /bgus.example passes otherwise"],
  ])("refuses %s (%s)", (candidate) => {
    expect(safeReturnTo(candidate, "bg")).toBe("/bg/lots");
  });

  it("refuses a control character, including a header-splitting newline", () => {
    expect(safeReturnTo("/bg/lots\nLocation: https://evil.example", "bg")).toBe("/bg/lots");
    expect(safeReturnTo("/bg/lots\u0000", "bg")).toBe("/bg/lots");
  });

  it("does not treat a lookalike prefix as the locale", () => {
    // "/bgus.example/..." starts with "/bg" but is not under "/bg/".
    expect(safeReturnTo("/bgus.example/lots", "bg")).toBe("/bg/lots");
  });
});
