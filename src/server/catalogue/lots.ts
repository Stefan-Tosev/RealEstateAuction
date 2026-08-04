import { prisma } from "@/lib/prisma";
import type { Locale } from "@/lib/i18n/locales";
import { toPublicLotDetail, toPublicLotSummary } from "./mappers";
import { publicLotDetailSelect, publicLotSummarySelect } from "./select";
import { DETAIL_VISIBLE_LOT_STATUSES, LISTABLE_LOT_STATUSES } from "./statuses";
import type { PublicLotDetail, PublicLotSummary } from "./types";

/*
 * The only file in the catalogue domain that touches Prisma. Everything
 * else — mappers, phase derivation, status lists — is pure and therefore
 * unit-testable without a database.
 */

/**
 * Soonest close first: for an auction catalogue that is the ordering
 * that matches intent, and it rides the
 * `@@index([status, effectiveCloseAt])` added for exactly this query.
 * Lots with no close date yet (preview, dates unannounced) sort last.
 */
export async function listPublicLots(locale: Locale): Promise<PublicLotSummary[]> {
  const rows = await prisma.lot.findMany({
    where: { status: { in: [...LISTABLE_LOT_STATUSES] } },
    select: publicLotSummarySelect,
    orderBy: [{ effectiveCloseAt: { sort: "asc", nulls: "last" } }, { lotNumber: "asc" }],
  });

  return rows.map((row) => toPublicLotSummary(row, locale));
}

/**
 * A property can be auctioned more than once (§2), so a slug can map to
 * several lots. Resolve to the most recent publicly visible one.
 */
export async function getPublicLotBySlug(
  slug: string,
  locale: Locale,
): Promise<PublicLotDetail | null> {
  const row = await prisma.lot.findFirst({
    where: {
      property: { slug },
      status: { in: [...DETAIL_VISIBLE_LOT_STATUSES] },
    },
    select: publicLotDetailSelect,
    orderBy: { lotNumber: "desc" },
  });

  return row ? toPublicLotDetail(row, locale) : null;
}

/** "Similar properties" on the detail page — same type, still listable. */
export async function listSimilarLots(
  lot: PublicLotDetail,
  locale: Locale,
  take = 3,
): Promise<PublicLotSummary[]> {
  const rows = await prisma.lot.findMany({
    where: {
      status: { in: [...LISTABLE_LOT_STATUSES] },
      property: {
        propertyType: lot.propertyType,
        slug: { not: lot.slug },
      },
    },
    select: publicLotSummarySelect,
    orderBy: [{ effectiveCloseAt: { sort: "asc", nulls: "last" } }, { lotNumber: "asc" }],
    take,
  });

  return rows.map((row) => toPublicLotSummary(row, locale));
}
