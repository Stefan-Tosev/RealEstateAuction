import { formatDateTime } from "@/lib/datetime";
import { gradientClassFor } from "@/lib/images";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import { locationLine } from "@/lib/i18n/places";
import { interpolate, plural } from "@/lib/i18n/plural";
import { formatMoney } from "@/lib/money";
import { mediaStorage } from "@/server/storage";
import { derivePhase } from "./phase";
import type { LotDetailRow, LotSummaryRow } from "./select";
import type { PublicImage, PublicLotDetail, PublicLotSummary } from "./types";

/*
 * The serialization boundary.
 *
 * Prisma rows carry `bigint`, `Prisma.Decimal` and `Date`. All three
 * break when handed to a client component — bigint and Decimal throw
 * outright, Date silently becomes a string somewhere it isn't expected.
 * Everything crossing out of this file is a string, number, boolean or
 * plain object.
 *
 * Deliberately not solved with a global `BigInt.prototype.toJSON`
 * polyfill: mutating a global hides the boundary you want visible, and
 * makes test output differ from production.
 *
 * Locale is resolved here too, so `titleBg`/`titleEn` collapse to one
 * `title` before a DTO exists and a page physically cannot render the
 * wrong language.
 */

type ImageRow = LotSummaryRow["property"]["images"][number];

function toPublicImage(row: ImageRow, locale: Locale): PublicImage {
  return {
    url: mediaStorage.publicUrl(row.storageKey),
    alt: locale === "bg" ? row.altBg : row.altEn,
    width: row.width,
    height: row.height,
  };
}

/** The derived facts v1 hand-authored as `meta: [{bg, en}]` strings. */
function buildMeta(property: LotSummaryRow["property"], locale: Locale): string[] {
  const t = getDictionary(locale);
  const meta: string[] = [];

  if (property.rooms !== null) meta.push(plural(locale, t.lot.rooms, property.rooms));
  // Decimal → number: areaSqm is Decimal(10,2), far inside safe range.
  if (property.areaSqm !== null) {
    meta.push(interpolate(t.lot.areaSqm, locale, property.areaSqm.toNumber()));
  }
  if (property.floor !== null) meta.push(interpolate(t.lot.floor, locale, property.floor));
  if (property.yearBuilt !== null) {
    // Year, not a quantity — must not get a thousands separator.
    meta.push(t.lot.yearBuilt.replace("{n}", String(property.yearBuilt)));
  }

  return meta;
}

export function toPublicLotSummary(row: LotSummaryRow, locale: Locale): PublicLotSummary {
  const { property } = row;
  const image = property.images[0];

  return {
    slug: property.slug,
    lotNumber: row.lotNumber,
    lotRef: String(row.lotNumber).padStart(3, "0"),
    status: row.status,
    title: locale === "bg" ? property.titleBg : property.titleEn,
    location: locationLine(property.city, property.region, locale),
    /*
     * Always the opening bid this pass — no bids exist until Phase 3.
     * Named rather than hardcoded so the bidding engine has a seam to
     * flip rather than a string to hunt down.
     */
    priceLabel: "openingBid",
    priceMinor: String(row.startingPriceMinor),
    priceFormatted: formatMoney(row.startingPriceMinor, locale),
    meta: buildMeta(property, locale),
    phase: derivePhase(row, locale),
    image: image ? toPublicImage(image, locale) : null,
    gradientClass: gradientClassFor(property.slug),
  };
}

export function toPublicLotDetail(row: LotDetailRow, locale: Locale): PublicLotDetail {
  const { property } = row;

  return {
    ...toPublicLotSummary(row, locale),
    // Detail only — the index has no need for it. See types.ts.
    id: row.id,
    propertyType: property.propertyType,
    description: locale === "bg" ? property.descriptionBg : property.descriptionEn,
    address: property.address,
    lat: property.lat?.toNumber() ?? null,
    lng: property.lng?.toNumber() ?? null,
    cadastralId: property.cadastralId,
    images: property.images.map((img) => toPublicImage(img, locale)),
    incrementFormatted: row.bidIncrementMinor
      ? formatMoney(row.bidIncrementMinor, locale)
      : null,
    previewStartsAtFormatted: row.previewStartsAt
      ? formatDateTime(row.previewStartsAt, locale)
      : null,
    biddingOpensAtFormatted: row.biddingOpensAt
      ? formatDateTime(row.biddingOpensAt, locale)
      : null,
    scheduledCloseAtFormatted: row.scheduledCloseAt
      ? formatDateTime(row.scheduledCloseAt, locale)
      : null,
  };
}
