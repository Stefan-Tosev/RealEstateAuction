import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toPublicLotDetail, toPublicLotSummary } from "@/server/catalogue/mappers";
import type { LotDetailRow } from "@/server/catalogue/select";

/*
 * The mappers are the serialization boundary. Prisma rows carry three
 * types that break when handed to a client component: bigint (throws),
 * Prisma.Decimal (a class instance) and Date. These tests pin that none
 * of them survive the crossing, and that the reserve is nowhere in the
 * output.
 */

const IMAGE = {
  storageKey: "properties/test-lot/01.jpg",
  altBg: "Фасадата",
  altEn: "The facade",
  width: 1600,
  height: 1200,
};

function detailRow(overrides: Partial<LotDetailRow> = {}): LotDetailRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    lotNumber: 11,
    status: "BIDDING_OPEN",
    previewStartsAt: new Date("2026-07-01T09:00:00Z"),
    biddingOpensAt: new Date("2026-07-22T09:00:00Z"),
    scheduledCloseAt: new Date("2026-07-27T09:00:00Z"),
    effectiveCloseAt: new Date("2026-07-27T09:05:00Z"),
    closedAt: null,
    startingPriceMinor: 10_000_000n,
    bidIncrementMinor: 200_000n,
    property: {
      slug: "test-lot",
      titleBg: "Двустаен апартамент",
      titleEn: "Two-room apartment",
      descriptionBg: "Описание на български.",
      descriptionEn: "Description in English.",
      address: "ул. Съборна 14, Пловдив",
      city: "Пловдив",
      region: "Пловдив",
      rooms: 2,
      areaSqm: new Prisma.Decimal("65.00"),
      floor: 4,
      yearBuilt: 1986,
      propertyType: "apartment",
      lat: new Prisma.Decimal("42.150000"),
      lng: new Prisma.Decimal("24.750000"),
      cadastralId: null,
      images: [IMAGE],
    },
    ...overrides,
  } as LotDetailRow;
}

describe("toPublicLotSummary", () => {
  it("produces output that JSON round-trips", () => {
    // The real failure this guards: passing a bigint or a Decimal as a
    // prop to a client component throws at render time, in production,
    // on a page that worked in every unit test.
    const dto = toPublicLotSummary(detailRow(), "bg");
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it("carries money as a decimal string, never a number", () => {
    const dto = toPublicLotSummary(detailRow(), "bg");
    expect(dto.priceMinor).toBe("10000000");
    expect(typeof dto.priceMinor).toBe("string");
  });

  it("never contains the reserve price", () => {
    const dto = toPublicLotSummary(detailRow(), "bg");
    expect(JSON.stringify(dto)).not.toMatch(/reserve/i);
  });

  it("resolves the locale so only one language survives", () => {
    const bg = toPublicLotSummary(detailRow(), "bg");
    const en = toPublicLotSummary(detailRow(), "en");

    expect(bg.title).toBe("Двустаен апартамент");
    expect(en.title).toBe("Two-room apartment");
    // The other language must not ride along — a page physically cannot
    // render the wrong one.
    expect(JSON.stringify(bg)).not.toContain("Two-room apartment");
  });

  it("translates the location but leaves the address alone", () => {
    const en = toPublicLotDetail(detailRow(), "en");
    expect(en.location).toBe("Plovdiv");
    // A postal address stays in the local language — it is what you type
    // into a map or hand to a taxi driver.
    expect(en.address).toBe("ул. Съборна 14, Пловдив");
  });

  it("derives pluralised meta from the numeric columns", () => {
    const bg = toPublicLotSummary(detailRow(), "bg");
    expect(bg.meta).toEqual(["2 стаи", "65 кв.м", "Етаж 4", "Построена 1986"]);
  });

  it("renders the year without a thousands separator", () => {
    const en = toPublicLotSummary(detailRow(), "en");
    // "Built 1,986" would be a nasty little bug.
    expect(en.meta).toContain("Built 1986");
  });

  it("omits meta entries whose columns are null", () => {
    const row = detailRow();
    const dto = toPublicLotSummary(
      { ...row, property: { ...row.property, rooms: null, floor: null } },
      "bg",
    );
    expect(dto.meta).toEqual(["65 кв.м", "Построена 1986"]);
  });

  it("zero-pads the lot reference for display", () => {
    expect(toPublicLotSummary(detailRow(), "bg").lotRef).toBe("011");
  });

  it("builds the image URL through the storage layer", () => {
    const dto = toPublicLotSummary(detailRow(), "bg");
    expect(dto.image).toEqual({
      url: "/media/properties/test-lot/01.jpg",
      alt: "Фасадата",
      width: 1600,
      height: 1200,
    });
  });

  it("always supplies a gradient class, even when an image exists", () => {
    const dto = toPublicLotSummary(detailRow(), "bg");
    expect(dto.gradientClass).toMatch(/^lot-image-[1-8]$/);
  });

  it("returns a null image when the property has none", () => {
    const row = detailRow();
    const dto = toPublicLotSummary(
      { ...row, property: { ...row.property, images: [] } },
      "bg",
    );
    expect(dto.image).toBeNull();
    expect(dto.gradientClass).toMatch(/^lot-image-[1-8]$/);
  });
});

describe("toPublicLotDetail", () => {
  it("converts Decimal coordinates to plain numbers", () => {
    const dto = toPublicLotDetail(detailRow(), "bg");
    expect(dto.lat).toBeCloseTo(42.15);
    expect(dto.lng).toBeCloseTo(24.75);
    expect(typeof dto.lat).toBe("number");
  });

  it("formats dates as Sofia-local strings, not Date objects", () => {
    const dto = toPublicLotDetail(detailRow(), "en");
    expect(typeof dto.scheduledCloseAtFormatted).toBe("string");
    // 09:00 UTC in July is 12:00 in Sofia.
    expect(dto.biddingOpensAtFormatted).toContain("12:00");
  });

  it("leaves the increment null when the lot has none", () => {
    const dto = toPublicLotDetail(detailRow({ bidIncrementMinor: null }), "bg");
    expect(dto.incrementFormatted).toBeNull();
  });

  it("never contains the reserve price", () => {
    expect(JSON.stringify(toPublicLotDetail(detailRow(), "bg"))).not.toMatch(/reserve/i);
  });

  it("exposes the whole gallery in order", () => {
    const row = detailRow();
    const second = { ...IMAGE, storageKey: "properties/test-lot/02.jpg" };
    const dto = toPublicLotDetail(
      { ...row, property: { ...row.property, images: [IMAGE, second] } },
      "bg",
    );
    expect(dto.images.map((i) => i.url)).toEqual([
      "/media/properties/test-lot/01.jpg",
      "/media/properties/test-lot/02.jpg",
    ]);
  });
});
