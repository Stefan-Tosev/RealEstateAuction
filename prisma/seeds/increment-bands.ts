import { prisma } from "../../src/lib/prisma";
import { DEFAULT_BANDS } from "../../src/server/auction/increments";

/*
 * Bid increment bands (§3).
 *
 * Seeded rather than hardcoded so an auctioneer can retune them without
 * a deploy — the spec is explicit that these live in a table for that
 * reason.
 *
 * The table is replaced, not merged. Upserting by lower bound alone was
 * the original design, on the reasoning that it would not clobber a band
 * someone had added by hand — but a band table is a partition of the
 * price line, not a set of independent rows. When the defaults moved
 * from five bands to four, the two obsolete lower bounds survived and
 * went on shadowing the new ones for every lot between €20,000 and
 * €100,000. A leftover row does not sit quietly next to the new table;
 * it silently wins for its slice of the range.
 */
export async function seedIncrementBands() {
  const keep = DEFAULT_BANDS.map((band) => band.fromMinor);

  await prisma.bidIncrementBand.deleteMany({ where: { fromMinor: { notIn: keep } } });

  for (const band of DEFAULT_BANDS) {
    await prisma.bidIncrementBand.upsert({
      where: { fromMinor: band.fromMinor },
      create: band,
      update: { incrementMinor: band.incrementMinor },
    });
  }

  console.log(`Seeded ${DEFAULT_BANDS.length} bid increment bands.`);
}
