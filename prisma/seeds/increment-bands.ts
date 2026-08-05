import { prisma } from "../../src/lib/prisma";
import { DEFAULT_BANDS } from "../../src/server/auction/increments";

/*
 * Bid increment bands (§3).
 *
 * Seeded rather than hardcoded so an auctioneer can retune them without
 * a deploy — the spec is explicit that these live in a table for that
 * reason. Upserted by lower bound, so re-seeding restores the documented
 * defaults without clobbering an unrelated band someone added.
 */
export async function seedIncrementBands() {
  for (const band of DEFAULT_BANDS) {
    await prisma.bidIncrementBand.upsert({
      where: { fromMinor: band.fromMinor },
      create: band,
      update: { incrementMinor: band.incrementMinor },
    });
  }

  console.log(`Seeded ${DEFAULT_BANDS.length} bid increment bands.`);
}
