import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * Minimum bid increments (§3).
 *
 * Banded on the *current* price, read from bid_increment_bands so an
 * auctioneer can retune them without a deploy.
 *
 * The result is a FLOOR, not a step. §3 is explicit: "min_next is a
 * FLOOR, not a step. Any amount above it is valid; jump bids are
 * expected and are what keep endgames short." Rounding a bid to the
 * nearest increment would be a different auction.
 */

/** The bands from §3, in minor units. Seeded, and editable afterwards. */
export const DEFAULT_BANDS: { fromMinor: bigint; incrementMinor: bigint }[] = [
  { fromMinor: 0n, incrementMinor: 25_000n }, // under €20,000 → €250
  { fromMinor: 2_000_000n, incrementMinor: 50_000n }, // €20k–50k → €500
  { fromMinor: 5_000_000n, incrementMinor: 100_000n }, // €50k–100k → €1,000
  { fromMinor: 10_000_000n, incrementMinor: 250_000n }, // €100k–250k → €2,500
  { fromMinor: 25_000_000n, incrementMinor: 500_000n }, // above €250k → €5,000
];

type Client = Prisma.TransactionClient;

/**
 * The increment that applies at `currentMinor`.
 *
 * Takes a client so it can run inside the bid transaction — the whole
 * decision has to happen under the lot lock, and reaching for a second
 * connection there deadlocks the pool under load.
 */
export async function incrementFor(client: Client, currentMinor: bigint): Promise<bigint> {
  const band = await client.bidIncrementBand.findFirst({
    where: { fromMinor: { lte: currentMinor } },
    orderBy: { fromMinor: "desc" },
  });

  if (band) return band.incrementMinor;

  /*
   * Empty table. Falling back to the smallest configured step is the
   * safe direction to be wrong in: it under-restricts rather than
   * blocking every bid on the auction house's busiest day.
   */
  return DEFAULT_BANDS[0].incrementMinor;
}

/**
 * The lowest amount that would be accepted next.
 *
 * With no accepted bids the floor is the starting price itself — the
 * first bid is *at* the guide, not a step above it.
 */
export async function minimumNextBid(
  client: Client,
  highestMinor: bigint | null,
  startingPriceMinor: bigint,
): Promise<bigint> {
  if (highestMinor === null) return startingPriceMinor;
  return highestMinor + (await incrementFor(client, highestMinor));
}

/** Pure version of the band lookup, for tests and for the UI's hint. */
export function incrementForFromBands(
  bands: { fromMinor: bigint; incrementMinor: bigint }[],
  currentMinor: bigint,
): bigint {
  let chosen = bands[0];
  for (const band of bands) {
    if (band.fromMinor <= currentMinor && band.fromMinor >= chosen.fromMinor) chosen = band;
  }
  return chosen.incrementMinor;
}
