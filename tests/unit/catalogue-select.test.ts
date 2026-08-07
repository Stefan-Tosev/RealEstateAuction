import { describe, expect, it } from "vitest";
import {
  publicLotDetailSelect,
  publicLotSummarySelect,
} from "@/server/catalogue/select";

/*
 * The reserve guard.
 *
 * docs/architecture.md §3 invariant 7: "The reserve price never appears
 * in any API response." The type system already makes reading
 * `row.reservePriceMinor` a compile error, because the mappers type
 * their input off these select objects. This test guards the other
 * direction — someone widening the allowlist, which would compile
 * perfectly happily.
 */

/** Every key name appearing anywhere in a nested Prisma select. */
function collectKeys(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== "object") return found;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    found.push(key);
    collectKeys(nested, found);
  }
  return found;
}

const SELECTS = {
  publicLotSummarySelect,
  publicLotDetailSelect,
};

describe.each(Object.entries(SELECTS))("%s", (_name, select) => {
  const keys = collectKeys(select);

  it("does not select the reserve price", () => {
    expect(keys.filter((k) => /reserve/i.test(k))).toEqual([]);
  });

  it("does not select other server-only lot fields", () => {
    // Soft-close internals and the deposit are operational data, not
    // catalogue data. Leaking the schedule would also telegraph the
    // anti-snipe behaviour to anyone reading the page source.
    expect(keys.filter((k) => /softClose|depositRequired/i.test(k))).toEqual([]);
  });

  it("selects the fields the cards and pages actually need", () => {
    expect(keys).toContain("startingPriceMinor");
    expect(keys).toContain("slug");
    expect(keys).toContain("titleBg");
    expect(keys).toContain("titleEn");
    expect(keys).toContain("images");
  });
});

describe("publicLotDetailSelect", () => {
  it("adds description and address on top of the summary fields", () => {
    const keys = collectKeys(publicLotDetailSelect);
    expect(keys).toContain("descriptionBg");
    expect(keys).toContain("descriptionEn");
    expect(keys).toContain("address");
    expect(keys).toContain("scheduledCloseAt");
  });
});

describe("the seller guard", () => {
  /*
   * Seller contact details are personal data and have no business in a
   * public catalogue payload. Same protection as the reserve, and for
   * the same reason: the type system stops anyone READING it, and this
   * stops anyone widening the allowlist to let it through.
   *
   * The harm is concrete. A seller's name and telephone number attached
   * to a property that is about to be auctioned is exactly what someone
   * would want in order to approach them off-platform — which is the
   * disclosure the anonymised bidding rules exist to prevent, coming in
   * through a different door.
   */
  const FORBIDDEN = ["seller", "sellerId", "email", "phone", "eik", "vat", "notes"];

  for (const [name, select] of Object.entries(SELECTS)) {
    it(`${name} exposes nothing about the seller`, () => {
      const keys = collectKeys(select);
      for (const forbidden of FORBIDDEN) {
        expect(keys, `${name} must not select ${forbidden}`).not.toContain(forbidden);
      }
    });
  }
});
