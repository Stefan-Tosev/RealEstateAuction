import type { LotStatus, PropertyType } from "@prisma/client";

/*
 * The public shape of a lot.
 *
 * Two invariants are encoded in these types rather than in review
 * comments:
 *
 *   1. No reserve field exists. Returning these as object literals from
 *      mappers.ts means excess-property checking rejects one being added
 *      by accident.
 *
 *   2. Every field is JSON-serializable. Prisma hands back `bigint`
 *      (not serializable), `Prisma.Decimal` (a class instance) and
 *      `Date` — all three throw or mangle when passed as props to a
 *      client component. The mapper is the boundary where they become
 *      strings and numbers.
 */

/** Money crosses as a decimal string of minor units — exact, and serializable. */
export type MinorUnits = string;

export type PublicImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * Preview and bidding are different phases with different countdown
 * targets and different affordances (docs/architecture.md §1). Modelling
 * that as a discriminated union means a component reads `phase.kind` and
 * cannot accidentally show a bid affordance on a lot in preview.
 */
export type LotPhase =
  | { kind: "preview"; targetIso: string; opensAtFormatted: string }
  | { kind: "bidding"; targetIso: string; closesAtFormatted: string }
  /** PUBLISHED but no bidding_opens_at set yet — dates to be announced. */
  | { kind: "scheduled" }
  | { kind: "closed"; closedAtFormatted: string | null };

export type PublicLotSummary = {
  slug: string;
  lotNumber: number;
  /** Zero-padded for display, carrying forward v1's "ЛОТ 011". */
  lotRef: string;
  status: LotStatus;
  title: string;
  location: string;
  priceLabel: "openingBid" | "currentBid";
  priceMinor: MinorUnits;
  priceFormatted: string;
  /** Derived, pluralised, already in the page's language. Cards show three. */
  meta: string[];
  phase: LotPhase;
  image: PublicImage | null;
  /** Always present; used when `image` is null. */
  gradientClass: string;
};

export type PublicLotDetail = PublicLotSummary & {
  propertyType: PropertyType;
  description: string;
  address: string;
  lat: number | null;
  lng: number | null;
  cadastralId: string | null;
  images: PublicImage[];
  incrementFormatted: string | null;
  previewStartsAtFormatted: string | null;
  biddingOpensAtFormatted: string | null;
  scheduledCloseAtFormatted: string | null;
};
