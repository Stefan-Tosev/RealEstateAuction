import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Guards the query filters. The mappers are covered separately; what
 * matters here is that a DRAFT lot can never reach them in the first
 * place, because the status allowlist is what stops an unpublished lot
 * from being served.
 */

const findMany = vi.fn();
const findFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { lot: { findMany: (...args: unknown[]) => findMany(...args),
                   findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

const { getPublicLotBySlug, listPublicLots, listSimilarLots } = await import(
  "@/server/catalogue/lots"
);
const { publicLotDetailSelect, publicLotSummarySelect } = await import(
  "@/server/catalogue/select"
);

describe("listPublicLots", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("asks only for listable statuses", async () => {
    await listPublicLots("bg");

    const [args] = findMany.mock.calls[0];
    expect(args.where.status.in).toEqual(["PUBLISHED", "BIDDING_OPEN", "EXTENDING"]);
    // The two that must never be listed.
    expect(args.where.status.in).not.toContain("DRAFT");
    expect(args.where.status.in).not.toContain("CANCELLED");
  });

  it("uses the reserve-free select allowlist", async () => {
    await listPublicLots("bg");
    expect(findMany.mock.calls[0][0].select).toBe(publicLotSummarySelect);
  });

  it("orders by soonest close, undated lots last", async () => {
    await listPublicLots("bg");

    // Matches @@index([status, effectiveCloseAt]).
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { effectiveCloseAt: { sort: "asc", nulls: "last" } },
      { lotNumber: "asc" },
    ]);
  });
});

describe("getPublicLotBySlug", () => {
  beforeEach(() => {
    findFirst.mockReset();
    findFirst.mockResolvedValue(null);
  });

  it("resolves finished lots as well as live ones", async () => {
    await getPublicLotBySlug("some-slug", "bg");

    const [args] = findFirst.mock.calls[0];
    // A shared or indexed URL must not start 404-ing once the lot ends.
    expect(args.where.status.in).toContain("CLOSED_SOLD");
    expect(args.where.status.in).toContain("CLOSED_UNSOLD");
    expect(args.where.status.in).toContain("RESERVE_NOT_MET");
  });

  it("still refuses DRAFT and CANCELLED", async () => {
    await getPublicLotBySlug("some-slug", "bg");

    const [args] = findFirst.mock.calls[0];
    expect(args.where.status.in).not.toContain("DRAFT");
    expect(args.where.status.in).not.toContain("CANCELLED");
  });

  it("filters by the property slug and uses the detail select", async () => {
    await getPublicLotBySlug("dvustaen-karshiyaka-plovdiv", "bg");

    const [args] = findFirst.mock.calls[0];
    expect(args.where.property).toEqual({ slug: "dvustaen-karshiyaka-plovdiv" });
    expect(args.select).toBe(publicLotDetailSelect);
  });

  it("takes the most recent lot when a property was auctioned twice", async () => {
    await getPublicLotBySlug("some-slug", "bg");
    expect(findFirst.mock.calls[0][0].orderBy).toEqual({ lotNumber: "desc" });
  });

  it("returns null rather than throwing when nothing matches", async () => {
    await expect(getPublicLotBySlug("missing", "bg")).resolves.toBeNull();
  });
});

describe("listSimilarLots", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("matches on property type and excludes the current lot", async () => {
    await listSimilarLots(
      { slug: "current", propertyType: "house" } as never,
      "bg",
    );

    const [args] = findMany.mock.calls[0];
    expect(args.where.property.propertyType).toBe("house");
    expect(args.where.property.slug).toEqual({ not: "current" });
    expect(args.take).toBe(3);
  });

  it("only suggests lots that are themselves listable", async () => {
    await listSimilarLots({ slug: "current", propertyType: "house" } as never, "bg");

    // Suggesting a DRAFT lot would link to a 404.
    expect(findMany.mock.calls[0][0].where.status.in).toEqual([
      "PUBLISHED",
      "BIDDING_OPEN",
      "EXTENDING",
    ]);
  });
});
