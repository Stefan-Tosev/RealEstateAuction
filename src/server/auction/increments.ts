import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/*
 * Bid increments (§3).
 *
 * Banded on the *current* price, read from bid_increment_bands so an
 * auctioneer can retune them without a deploy.
 *
 * The result is a STEP, not a floor. §3 originally specified a floor
 * with jump bids allowed, and that was changed deliberately: free entry
 * of an amount means a bidder can type an extra zero, and a bid binds.
 * The trade is fewer ways to end a contest quickly, which is why the
 * bands below are steeper than a floor-based table would need to be —
 * step size is now the only control on how fast price moves.
 *
 * A lot may override the band with its own bid_increment_minor. The
 * override wins wherever it is set, and it must win *everywhere* — the
 * price shown on the lot page and the price the engine will accept are
 * the same number or the page is lying to the bidder.
 */

/**
 * The bands, in minor units.
 *
 * Each starts at about 4–5% of the price and decays to 2% by the time
 * the next band takes over. Steeper than a floor-based table, on purpose
 * — see above.
 */
export const DEFAULT_BANDS: { fromMinor: bigint; incrementMinor: bigint }[] = [
  { fromMinor: 0n, incrementMinor: 200_000n }, // under €100,000 → €2,000
  { fromMinor: 10_000_000n, incrementMinor: 500_000n }, // €100k–250k → €5,000
  { fromMinor: 25_000_000n, incrementMinor: 1_000_000n }, // €250k–500k → €10,000
  { fromMinor: 50_000_000n, incrementMinor: 2_500_000n }, // above €500k → €25,000
];

type Client = Prisma.TransactionClient;

/**
 * The increment that applies at `currentMinor`.
 *
 * Takes a client so it can run inside the bid transaction — the whole
 * decision has to happen under the lot lock, and reaching for a second
 * connection there deadlocks the pool under load.
 *
 * `lotIncrementMinor` is the per-lot override. It wins when set, because
 * an auctioneer setting an increment on a particular lot means it.
 */
export async function incrementFor(
  client: Client,
  currentMinor: bigint,
  lotIncrementMinor?: bigint | null,
): Promise<bigint> {
  if (lotIncrementMinor && lotIncrementMinor > 0n) return lotIncrementMinor;

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
 * The one amount that would be accepted next.
 *
 * With no accepted bids that is the starting price itself — the first
 * bid is *at* the guide, not a step above it. After that it is exactly
 * one increment above the highest bid, and nothing else is valid.
 */
export async function minimumNextBid(
  client: Client,
  highestMinor: bigint | null,
  startingPriceMinor: bigint,
  lotIncrementMinor?: bigint | null,
): Promise<bigint> {
  if (highestMinor === null) return startingPriceMinor;
  return highestMinor + (await incrementFor(client, highestMinor, lotIncrementMinor));
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
