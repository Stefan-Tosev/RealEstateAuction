import { prisma } from "../../src/lib/prisma";
import { LISTINGS, type SeedListing } from "./listings";

/*
 * Turns the demo listings into Property / Lot / PropertyImage rows.
 *
 * Idempotent: upserts on the natural keys (property slug, then
 * propertyId + lotNumber). Re-running also refreshes every date, which
 * is the point — one command un-rots a local catalogue whose lots have
 * all closed since the last seed.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** docs/architecture.md §1: 21-day preview, then a 5-day bidding window. */
const PREVIEW_DAYS = 21;
const BIDDING_DAYS = 5;

function timeline(listing: SeedListing, now: Date) {
  const closesAt = new Date(now.getTime() + listing.closesInHours * HOUR_MS);
  const biddingOpensAt = new Date(closesAt.getTime() - BIDDING_DAYS * DAY_MS);
  const previewStartsAt = new Date(biddingOpensAt.getTime() - PREVIEW_DAYS * DAY_MS);

  const isClosed = ["CLOSED_SOLD", "CLOSED_UNSOLD", "RESERVE_NOT_MET"].includes(listing.status);

  return {
    previewStartsAt,
    biddingOpensAt,
    // scheduled_close_at is the published close and never moves;
    // effective_close_at is authoritative and shifts on soft close. They
    // are equal until the soft-close engine (Phase 3) moves one.
    scheduledCloseAt: closesAt,
    effectiveCloseAt: closesAt,
    closedAt: isClosed ? closesAt : null,
  };
}

export async function seedCatalogue() {
  /*
   * §10: a lot with no agreed reserve cannot be published — the
   * auctioneer agrees it, sellers do not set it unilaterally. Attributing
   * the seeded reserves to the seeded admin keeps these lots legitimately
   * publishable instead of quietly violating that rule.
   */
  const admin = await prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } });
  if (!admin) {
    throw new Error("Seed the admin user before the catalogue — lots need an agreed reserve.");
  }

  const now = new Date();

  for (const listing of LISTINGS) {
    const dates = timeline(listing, now);

    const propertyData = {
      titleBg: listing.titleBg,
      titleEn: listing.titleEn,
      descriptionBg: listing.descriptionBg,
      descriptionEn: listing.descriptionEn,
      address: listing.address,
      city: listing.city,
      region: listing.region,
      propertyType: listing.propertyType,
      rooms: listing.rooms,
      areaSqm: listing.areaSqm,
      floor: listing.floor,
      yearBuilt: listing.yearBuilt,
    };

    const property = await prisma.property.upsert({
      where: { slug: listing.slug },
      create: { slug: listing.slug, ...propertyData },
      update: propertyData,
    });

    const lotData = {
      status: listing.status,
      ...dates,
      startingPriceMinor: listing.startingPriceMinor,
      bidIncrementMinor: listing.bidIncrementMinor,
      /*
       * FABRICATED. A reserve is a commercial decision an auctioneer
       * makes per lot after talking to the seller (§10) — this 110% rule
       * is a placeholder to satisfy a required column, not a
       * recommendation. Do not copy it into anything real.
       */
      reservePriceMinor: (listing.startingPriceMinor * 110n) / 100n,
      depositRequiredMinor: (listing.startingPriceMinor * 5n) / 100n,
      reserveAgreedBy: admin.id,
      reserveAgreedAt: now,
    };

    const lot = await prisma.lot.upsert({
      where: { propertyId_lotNumber: { propertyId: property.id, lotNumber: listing.lotNumber } },
      create: { propertyId: property.id, lotNumber: listing.lotNumber, ...lotData },
      update: lotData,
    });

    /*
     * Images have no natural key beyond (propertyId, storageKey), and a
     * gallery is an ordered set rather than a bag of rows — replacing it
     * wholesale re-syncs ordering and removals in one step, and at seed
     * scale the cost is nil.
     */
    await prisma.propertyImage.deleteMany({ where: { propertyId: property.id } });
    await prisma.propertyImage.createMany({
      data: listing.images.map((image, index) => ({
        propertyId: property.id,
        storageKey: `properties/${listing.slug}/${image.file}`,
        altBg: image.altBg,
        altEn: image.altEn,
        width: image.width,
        height: image.height,
        sortOrder: index,
      })),
    });

    console.log(
      `Seeded lot ${String(lot.lotNumber).padStart(3, "0")} ${listing.slug} ` +
        `(${listing.status}, ${listing.images.length} image(s))`,
    );
  }
}
