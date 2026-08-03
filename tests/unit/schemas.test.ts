import { describe, expect, it } from "vitest";
import { fieldErrors, lotSchema, propertySchema, slugSchema } from "@/server/catalogue/schemas";

/*
 * Server-side validation. Everything the browser does is a convenience;
 * these are the rules that actually hold — the same split CLAUDE.md
 * records for the v1 registration form.
 */

function propertyForm(overrides: Record<string, string> = {}) {
  return {
    slug: "dvustaen-test",
    titleBg: "Двустаен апартамент",
    titleEn: "Two-room apartment",
    descriptionBg: "Описание.",
    descriptionEn: "Description.",
    address: "ул. Тестова 1",
    city: "София",
    region: "София",
    propertyType: "apartment",
    rooms: "",
    areaSqm: "",
    floor: "",
    yearBuilt: "",
    cadastralId: "",
    ...overrides,
  };
}

function lotForm(overrides: Record<string, string> = {}) {
  return {
    propertyId: "11111111-1111-1111-1111-111111111111",
    lotNumber: "11",
    startingPriceMinor: "100000",
    reservePriceMinor: "110000",
    bidIncrementMinor: "",
    depositRequiredMinor: "",
    previewStartsAt: "",
    biddingOpensAt: "",
    scheduledCloseAt: "",
    ...overrides,
  };
}

describe("slugSchema", () => {
  it("accepts kebab-case", () => {
    expect(slugSchema.parse("dvustaen-karshiyaka-plovdiv")).toBe("dvustaen-karshiyaka-plovdiv");
  });

  it("lowercases and trims", () => {
    expect(slugSchema.parse("  Dvustaen-Test  ")).toBe("dvustaen-test");
  });

  it("refuses Cyrillic", () => {
    // A slug is a permanent public URL; percent-encoded Cyrillic in every
    // canonical tag and sitemap entry is a poor trade.
    expect(slugSchema.safeParse("двустаен").success).toBe(false);
  });

  it("refuses spaces, underscores and doubled hyphens", () => {
    expect(slugSchema.safeParse("two words").success).toBe(false);
    expect(slugSchema.safeParse("two_words").success).toBe(false);
    expect(slugSchema.safeParse("two--words").success).toBe(false);
  });
});

describe("propertySchema", () => {
  it("accepts a complete property", () => {
    expect(propertySchema.safeParse(propertyForm()).success).toBe(true);
  });

  it("requires both languages", () => {
    // The half-translated listing is exactly what the bilingual pattern
    // exists to prevent, and the columns are NOT NULL.
    const missingEn = propertySchema.safeParse(propertyForm({ titleEn: "" }));
    expect(missingEn.success).toBe(false);
    if (!missingEn.success) {
      expect(fieldErrors(missingEn.error).titleEn).toMatch(/required/i);
    }

    expect(propertySchema.safeParse(propertyForm({ descriptionBg: "   " })).success).toBe(false);
  });

  it("treats an empty optional field as absent rather than as an empty string", () => {
    // FormData never omits a field, so "" has to mean null.
    const parsed = propertySchema.parse(propertyForm());
    expect(parsed.rooms).toBeNull();
    expect(parsed.cadastralId).toBeNull();
  });

  it("refuses a number that is only partly a number", () => {
    // Number("12abc") is NaN, but a lenient parse would take "12".
    expect(propertySchema.safeParse(propertyForm({ rooms: "12abc" })).success).toBe(false);
  });

  it("bounds the numeric fields", () => {
    expect(propertySchema.safeParse(propertyForm({ yearBuilt: "1200" })).success).toBe(true);
    expect(propertySchema.safeParse(propertyForm({ yearBuilt: "12" })).success).toBe(false);
    expect(propertySchema.safeParse(propertyForm({ rooms: "-1" })).success).toBe(false);
  });

  it("accepts Cyrillic everywhere except the slug", () => {
    const parsed = propertySchema.parse(propertyForm({ city: "Пловдив" }));
    expect(parsed.city).toBe("Пловдив");
  });
});

describe("money parsing", () => {
  it("converts euros to minor units exactly", () => {
    expect(lotSchema.parse(lotForm()).startingPriceMinor).toBe(10_000_000n);
  });

  it("does not lose a cent to floating point", () => {
    /*
     * The reason this is string arithmetic: 19.99 * 100 is
     * 1998.9999999999998 in IEEE 754, and this is money.
     */
    const parsed = lotSchema.parse(
      lotForm({ startingPriceMinor: "19.99", reservePriceMinor: "20.99" }),
    );
    expect(parsed.startingPriceMinor).toBe(1999n);
  });

  it("accepts the separators an operator actually types", () => {
    expect(lotSchema.parse(lotForm({ startingPriceMinor: "100 000" })).startingPriceMinor).toBe(
      10_000_000n,
    );
    expect(lotSchema.parse(lotForm({ startingPriceMinor: "100,000" })).startingPriceMinor).toBe(
      10_000_000n,
    );
  });

  it("pads a single decimal place", () => {
    // The reserve moves with the guide here — the 150% rule is checked
    // across both fields, so changing one alone trips it.
    const parsed = lotSchema.parse(
      lotForm({ startingPriceMinor: "10.5", reservePriceMinor: "11" }),
    );
    expect(parsed.startingPriceMinor).toBe(1050n);
    expect(parsed.reservePriceMinor).toBe(1100n);
  });

  it("refuses letters, negatives and three decimals", () => {
    for (const bad of ["abc", "-100", "10.555", ""]) {
      expect(lotSchema.safeParse(lotForm({ startingPriceMinor: bad })).success).toBe(false);
    }
  });
});

describe("lotSchema reserve rules", () => {
  it("refuses a reserve below the guide price", () => {
    // The guide is what bidders are told to expect; a reserve under it
    // is meaningless.
    const result = lotSchema.safeParse(
      lotForm({ startingPriceMinor: "100000", reservePriceMinor: "90000" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).reservePriceMinor).toMatch(/below the guide/i);
    }
  });

  it("accepts the ~110% convention", () => {
    expect(
      lotSchema.safeParse(lotForm({ startingPriceMinor: "100000", reservePriceMinor: "110000" }))
        .success,
    ).toBe(true);
  });

  it("refuses a fantasy reserve, citing the convention", () => {
    /*
     * §10: "Lots miss reserve almost entirely because the reserve was
     * unrealistic." Refusing 150%+ is the structural fix expressed in
     * code rather than in a policy document nobody reads.
     */
    const result = lotSchema.safeParse(
      lotForm({ startingPriceMinor: "100000", reservePriceMinor: "200000" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).reservePriceMinor).toMatch(/110%/);
    }
  });
});

describe("lotSchema date rules", () => {
  it("requires the close to follow the opening", () => {
    const result = lotSchema.safeParse(
      lotForm({ biddingOpensAt: "2026-09-10T10:00", scheduledCloseAt: "2026-09-01T10:00" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).scheduledCloseAt).toMatch(/after bidding opens/i);
    }
  });

  it("requires the preview to precede the opening", () => {
    const result = lotSchema.safeParse(
      lotForm({ previewStartsAt: "2026-09-20T10:00", biddingOpensAt: "2026-09-10T10:00" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a lot with no dates yet — that is a publish blocker, not a save blocker", () => {
    // Drafting a lot before the schedule is agreed is normal.
    expect(lotSchema.safeParse(lotForm()).success).toBe(true);
  });

  it("rejects an unparseable date", () => {
    expect(lotSchema.safeParse(lotForm({ biddingOpensAt: "not-a-date" })).success).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("reports one message per field", () => {
    const result = propertySchema.safeParse(propertyForm({ titleEn: "", descriptionEn: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      // Three messages stacked on one input is noise.
      expect(Object.keys(errors).sort()).toEqual(["descriptionEn", "titleEn"]);
    }
  });
});
