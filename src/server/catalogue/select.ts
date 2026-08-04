import { Prisma } from "@prisma/client";

/*
 * Prisma `select` allowlists — the first and most important line of
 * defence for docs/architecture.md §3 invariant 7: "The reserve price
 * never appears in any API response."
 *
 * Rules for this file:
 *   - never `include`, never a bare findMany() — both return every column
 *   - reserve_price_minor, reserve_agreed_by/at, soft_close_schedule and
 *     deposit_required_minor are absent, not filtered out later
 *
 * Because mappers.ts types its input as
 * `Prisma.LotGetPayload<{ select: typeof publicLotSummarySelect }>`,
 * anything omitted here does not exist downstream: reading it is a
 * compile error, not a code-review miss.
 */

const imageSelect = {
  select: {
    storageKey: true,
    altBg: true,
    altEn: true,
    width: true,
    height: true,
  },
  orderBy: { sortOrder: "asc" },
} as const;

export const publicLotSummarySelect = {
  id: true,
  lotNumber: true,
  status: true,
  previewStartsAt: true,
  biddingOpensAt: true,
  effectiveCloseAt: true,
  closedAt: true,
  startingPriceMinor: true,
  bidIncrementMinor: true,
  property: {
    select: {
      slug: true,
      titleBg: true,
      titleEn: true,
      city: true,
      region: true,
      rooms: true,
      areaSqm: true,
      floor: true,
      yearBuilt: true,
      propertyType: true,
      // Cards show one image; the gallery is a detail-page concern.
      images: { ...imageSelect, take: 1 },
    },
  },
} satisfies Prisma.LotSelect;

export const publicLotDetailSelect = {
  ...publicLotSummarySelect,
  scheduledCloseAt: true,
  property: {
    select: {
      ...publicLotSummarySelect.property.select,
      descriptionBg: true,
      descriptionEn: true,
      address: true,
      lat: true,
      lng: true,
      cadastralId: true,
      // Whole gallery, in order.
      images: imageSelect,
    },
  },
} satisfies Prisma.LotSelect;

export type LotSummaryRow = Prisma.LotGetPayload<{ select: typeof publicLotSummarySelect }>;
export type LotDetailRow = Prisma.LotGetPayload<{ select: typeof publicLotDetailSelect }>;
