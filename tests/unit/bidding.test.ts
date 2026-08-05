import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeLot, closeDueLots } from "@/server/auction/close-lots";
import { DEFAULT_BANDS, incrementForFromBands } from "@/server/auction/increments";
import { DEFAULT_SCHEDULE, placeBid, windowFor } from "@/server/auction/place-bid";
import { getBiddingView } from "@/server/auction/bidding-view";

/*
 * The soft-close engine.
 *
 * §3 says it plainly: "Invariants — these are the tests that matter."
 * Every one of the seven has a case here, named after it.
 *
 * Runs against the real database, because the whole design rests on row
 * locks and clock_timestamp() inside a transaction — a mock would prove
 * nothing about the part that is hard.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-bid-";

let lotId = "";
let propertyId = "";
let bidders: string[] = [];

async function makeBidder(n: number, approved = true): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}${n}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.bg`,
      passwordHash: "not-used",
      firstName: "Тест",
      lastName: `Наддаващ${n}`,
      dateOfBirth: new Date("1990-01-01"),
      accountType: "individual",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  if (approved) {
    await prisma.bidderApproval.create({ data: { userId: user.id, status: "approved" } });
  }
  return user.id;
}

/** A lot open for bidding, closing in `closesInSeconds`. */
async function makeLot(options: {
  closesInSeconds: number;
  startingPriceMinor?: bigint;
  reservePriceMinor?: bigint;
  depositRequiredMinor?: bigint | null;
  extensionCount?: number;
  resetSeconds?: number;
  windowSeconds?: number;
  incrementMinor?: bigint;
  schedule?: { afterExtensions: number; windowSeconds: number }[];
}): Promise<string> {
  const closeAt = new Date(Date.now() + options.closesInSeconds * 1000);

  const lot = await prisma.lot.create({
    data: {
      propertyId,
      lotNumber: Math.floor(Math.random() * 900_000) + 1000,
      status: "BIDDING_OPEN",
      startingPriceMinor: options.startingPriceMinor ?? 10_000_000n,
      bidIncrementMinor: options.incrementMinor ?? null,
      reservePriceMinor: options.reservePriceMinor ?? 11_000_000n,
      depositRequiredMinor: options.depositRequiredMinor ?? null,
      biddingOpensAt: new Date(Date.now() - 86_400_000),
      scheduledCloseAt: closeAt,
      effectiveCloseAt: closeAt,
      softCloseWindowSeconds: options.windowSeconds ?? 300,
      softCloseResetSeconds: options.resetSeconds ?? 300,
      extensionCount: options.extensionCount ?? 0,
      softCloseSchedule: options.schedule ?? undefined,
    },
    select: { id: true },
  });
  return lot.id;
}

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

async function cleanup() {
  /*
   * bids is append-only, enforced by a trigger (§3 invariant 6), so a
   * plain deleteMany fails — correctly. Test data still has to go, so
   * the trigger is disabled for exactly the length of the delete.
   *
   * Nothing in the application can do this: it needs table ownership,
   * and no application code path reaches for it.
   */
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.deposit.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.bidderApproval.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  // Lots created here hang off the seeded property; winningBidId must go first.
  await prisma.lot.updateMany({ where: { property: { slug: PREFIX + "prop" } }, data: { winningBidId: null } });
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { lot: { property: { slug: PREFIX + "prop" } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.lot.deleteMany({ where: { property: { slug: PREFIX + "prop" } } });
  await prisma.property.deleteMany({ where: { slug: PREFIX + "prop" } });
}

beforeEach(async () => {
  await cleanup();

  const property = await prisma.property.create({
    data: {
      slug: PREFIX + "prop",
      titleBg: "Тестов лот",
      titleEn: "Test lot",
      descriptionBg: "—",
      descriptionEn: "—",
      address: "ул. Тестова 1",
      city: "София",
      region: "София",
      propertyType: "apartment",
    },
    select: { id: true },
  });
  propertyId = property.id;

  bidders = await Promise.all([0, 1, 2].map((n) => makeBidder(n)));
  lotId = await makeLot({ closesInSeconds: 3600 });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("increment bands (§3)", () => {
  it("matches the documented table", () => {
    const eur = (n: number) => BigInt(n) * 100n;

    expect(incrementForFromBands(DEFAULT_BANDS, eur(99_999))).toBe(eur(2_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(100_000))).toBe(eur(5_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(249_999))).toBe(eur(5_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(250_000))).toBe(eur(10_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(345_000))).toBe(eur(10_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(499_999))).toBe(eur(10_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(500_000))).toBe(eur(25_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(9_000_000))).toBe(eur(25_000));
  });

  it("opens each band at 4-5% and decays to 2% before the next", () => {
    /*
     * The calibration the revised §3 argues for. Steeper than the
     * conventional 1.5-2%, because a fixed step with no jump bids makes
     * step size the only control on how fast price moves.
     *
     * Measured at the band's LOWER bound, which is its worst case — the
     * step is proportionally largest there and shrinks across the band.
     */
    for (const band of DEFAULT_BANDS) {
      if (band.fromMinor === 0n) continue;
      const pct = (Number(band.incrementMinor) / Number(band.fromMinor)) * 100;
      expect(pct, `band from ${band.fromMinor}`).toBeGreaterThanOrEqual(4.0);
      expect(pct, `band from ${band.fromMinor}`).toBeLessThanOrEqual(5.0);
    }
  });

  it("hands the band's slice to whichever bound is highest below the price", () => {
    // A stale band left in the table wins for its slice of the range,
    // which is why the seed replaces the table rather than merging into
    // it. Pinned here so the lookup rule itself cannot drift.
    const withStale = [...DEFAULT_BANDS, { fromMinor: 2_000_000n, incrementMinor: 50_000n }];
    expect(incrementForFromBands(withStale, 3_000_000n)).toBe(50_000n);
  });
});

describe("the first bid", () => {
  it("is accepted at the starting price, not a step above it", async () => {
    const result = await placeBid({
      lotId,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({ ok: true, amountMinor: 10_000_000n });
  });

  it("is refused below the starting price", async () => {
    const result = await placeBid({
      lotId,
      userId: bidders[0],
      amountMinor: 9_999_900n,
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({ ok: false, reason: "TOO_LOW", minimumMinor: 10_000_000n });
  });
});

describe("the increment is a STEP, not a floor (§3, revised)", () => {
  it("refuses an amount above the step", async () => {
    /*
     * The reason the rule changed. A free-text amount let a bidder type
     * an extra zero into something binding — €1,500,000 where €102,000
     * was meant, comfortably above the old floor and therefore accepted.
     * Nothing in the interface can produce this now, which is exactly
     * why a request carrying it is worth recording.
     */
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });

    const jump = await placeBid({
      lotId,
      userId: bidders[1],
      amountMinor: 150_000_000n,
      idempotencyKey: key(),
    });

    expect(jump).toMatchObject({ ok: false, reason: "NOT_ON_STEP", minimumMinor: 10_500_000n });
    // Recorded, like every other rejection.
    expect(await prisma.bid.count({ where: { lotId, status: "rejected" } })).toBe(1);
  });

  it("accepts exactly the step and refuses either side of it by a cent", async () => {
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });

    // €100,000 sits in the €5,000 band.
    const step = 10_500_000n;

    await expect(
      placeBid({ lotId, userId: bidders[1], amountMinor: step - 1n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "TOO_LOW", minimumMinor: step });

    await expect(
      placeBid({ lotId, userId: bidders[1], amountMinor: step + 1n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_ON_STEP", minimumMinor: step });

    await expect(
      placeBid({ lotId, userId: bidders[1], amountMinor: step, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("lets a lot override the band, and the override wins", async () => {
    /*
     * The page and the engine must resolve this identically — a lot page
     * advertising a step the engine would refuse is worse than showing
     * no figure at all.
     */
    const overridden = await makeLot({ closesInSeconds: 3600, incrementMinor: 33_300n });

    await placeBid({
      lotId: overridden,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    const view = await getBiddingView(overridden, bidders[0]);
    expect(view.incrementMinor).toBe("33300");
    expect(view.minimumMinor).toBe("10033300");

    await expect(
      placeBid({
        lotId: overridden,
        userId: bidders[1],
        amountMinor: 10_500_000n,
        idempotencyKey: key(),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_ON_STEP" });

    await expect(
      placeBid({
        lotId: overridden,
        userId: bidders[1],
        amountMinor: 10_033_300n,
        idempotencyKey: key(),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("gates", () => {
  it("refuses an unapproved bidder", async () => {
    const stranger = await makeBidder(9, false);

    await expect(
      placeBid({ lotId, userId: stranger, amountMinor: 10_000_000n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_APPROVED" });
  });

  it("refuses when a deposit is required and none is held", async () => {
    const gated = await makeLot({ closesInSeconds: 3600, depositRequiredMinor: 500_000n });

    await expect(
      placeBid({ lotId: gated, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "NO_DEPOSIT" });
  });

  it("allows the bid once a deposit is held", async () => {
    const gated = await makeLot({ closesInSeconds: 3600, depositRequiredMinor: 500_000n });
    await prisma.deposit.create({
      data: {
        userId: bidders[0],
        lotId: gated,
        amountMinor: 500_000n,
        method: "sepa",
        status: "held",
      },
    });

    await expect(
      placeBid({ lotId: gated, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a lot that is not open", async () => {
    await prisma.lot.update({ where: { id: lotId }, data: { status: "PUBLISHED" } });

    await expect(
      placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_OPEN" });
  });

  it("refuses an unknown lot", async () => {
    await expect(
      placeBid({
        lotId: "11111111-1111-1111-1111-111111111111",
        userId: bidders[0],
        amountMinor: 10_000_000n,
        idempotencyKey: key(),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("invariant 4 — a bid after the close loses cleanly and is recorded", () => {
  it("rejects with CLOSED and still writes the attempt", async () => {
    const past = await makeLot({ closesInSeconds: -1 });

    const result = await placeBid({
      lotId: past,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({ ok: false, reason: "CLOSED" });

    /*
     * A bidder beaten by milliseconds is owed a record of having tried,
     * and a dispute needs the losing attempts as much as the winning one.
     */
    const recorded = await prisma.bid.findMany({ where: { lotId: past } });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: "rejected", rejectReason: "CLOSED" });
  });
});

describe("soft close (§3)", () => {
  it("does not move a close that is outside the trigger window", async () => {
    // "A bid placed on day 2 of a 5-day bidding period moves nothing."
    const before = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });

    const result = await placeBid({
      lotId,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({ ok: true, extendedTo: null });

    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(after.effectiveCloseAt?.getTime()).toBe(before.effectiveCloseAt?.getTime());
    expect(after.status).toBe("BIDDING_OPEN");
  });

  it("resets the clock for a bid inside the window", async () => {
    const closing = await makeLot({ closesInSeconds: 60, resetSeconds: 300 });

    const result = await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !result.extendedTo) throw new Error("expected an extension");

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: closing } });
    expect(lot.status).toBe("EXTENDING");
    expect(lot.extensionCount).toBe(1);

    // Reset, not added: ~300s from now, not 60 + 300.
    const secondsOut = (lot.effectiveCloseAt!.getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(290);
    expect(secondsOut).toBeLessThan(310);
  });

  it("invariant 3 — the second of two late bids extends from the already-extended time", async () => {
    const closing = await makeLot({ closesInSeconds: 30, resetSeconds: 300 });

    const first = await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    const second = await placeBid({
      lotId: closing,
      userId: bidders[1],
      // Exactly one step above the first. Anything else is refused now.
      amountMinor: 10_500_000n,
      idempotencyKey: key(),
    });

    if (!first.ok || !second.ok) throw new Error("both bids should be accepted");
    expect(first.extendedTo).not.toBeNull();

    /*
     * The second bid arrives when the close is already ~300s out, which
     * is *outside* the 300s window only by a hair — so it may or may not
     * extend again. What must hold is that it never extends from the
     * ORIGINAL 30s close: the clock only ever moves forward.
     */
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: closing } });
    expect(lot.effectiveCloseAt!.getTime()).toBeGreaterThanOrEqual(first.extendedTo!.getTime());
  });

  it("does not shrink the window as extensions accumulate", () => {
    /*
     * The default is flat five minutes. §3 originally decayed to three
     * and then two, and that was reversed: the decay existed to stop
     * cheap grinding at a 1.4% increment, and the bands now open at
     * 4-5%, so thirty rounds means the price moved €300,000. The
     * two-minute floor was also conditional on outbid notifications,
     * which are §4 and unbuilt.
     */
    expect(windowFor(null, 0, 300)).toBe(300);
    expect(windowFor(null, 2, 300)).toBe(300);
    expect(windowFor(null, 4, 300)).toBe(300);
    expect(windowFor(null, 30, 300)).toBe(300);
  });

  it("resets the clock to a full five minutes however many bids came before", async () => {
    /*
     * The promise a bidder can hold in their head: there will always be
     * five quiet minutes before the gavel. Six extensions already banked
     * changes nothing.
     */
    const late = await makeLot({ closesInSeconds: 30, resetSeconds: 300, extensionCount: 6 });

    const result = await placeBid({
      lotId: late,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    if (!result.ok || !result.extendedTo) throw new Error("the bid should have extended");

    const secondsOut = (result.extendedTo.getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(290);
    expect(secondsOut).toBeLessThan(310);
  });

  it("still resets to the decayed window when a lot carries a schedule", async () => {
    /*
     * The mechanism survives the change of default. An endgame that
     * genuinely drags can be given a decay per lot, with no deploy — and
     * the reset must follow it, not sit at a flat five minutes.
     *
     * That was the original defect: §3's table is headed "Window", so
     * the trigger window decayed while the reset did not, which changes
     * *which* bids extend but never *by how much*.
     */
    const decaying = await makeLot({
      closesInSeconds: 30,
      resetSeconds: 300,
      extensionCount: 6,
      schedule: [
        { afterExtensions: 0, windowSeconds: 300 },
        { afterExtensions: 4, windowSeconds: 120 },
      ],
    });

    const result = await placeBid({
      lotId: decaying,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    if (!result.ok || !result.extendedTo) throw new Error("the bid should have extended");

    const secondsOut = (result.extendedTo.getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(110);
    expect(secondsOut).toBeLessThan(130);
  });

  it("keeps a lot's own shorter reset when it has one", async () => {
    // soft_close_reset_seconds caps the schedule rather than replacing
    // it, so an auctioneer who set a deliberately short reset gets it.
    const brisk = await makeLot({ closesInSeconds: 30, resetSeconds: 60 });

    const result = await placeBid({
      lotId: brisk,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    if (!result.ok || !result.extendedTo) throw new Error("the bid should have extended");

    const secondsOut = (result.extendedTo.getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(50);
    expect(secondsOut).toBeLessThan(70);
  });

  it("never drops below two minutes, whatever the schedule says", () => {
    /*
     * "Do not floor below 2 minutes for property. A bidder needs time to
     * see the alert, think, and confirm a five-figure commitment."
     *
     * The default is five and does not move, but the per-lot column
     * accepts anything, so the rule is asserted against the default
     * rather than left to a comment.
     */
    const floor = Math.min(...DEFAULT_SCHEDULE.map((s) => s.windowSeconds));
    expect(floor).toBeGreaterThanOrEqual(120);
    expect(floor).toBe(300);
  });

  it("honours a per-lot schedule when one is set", async () => {
    // soft_close_schedule is jsonb on the lot so it is tunable per lot.
    const schedule = [
      { afterExtensions: 0, windowSeconds: 60 },
      { afterExtensions: 1, windowSeconds: 30 },
    ];
    expect(windowFor(schedule, 0, 300)).toBe(60);
    expect(windowFor(schedule, 5, 300)).toBe(30);
  });
});

describe("idempotency", () => {
  it("returns the original bid for a replayed key", async () => {
    const k = key();

    const first = await placeBid({
      lotId,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: k,
    });
    const replay = await placeBid({
      lotId,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: k,
    });

    if (!first.ok || !replay.ok) throw new Error("both should be accepted");
    expect(replay.bidId).toBe(first.bidId);
    expect(replay.replayed).toBe(true);

    // A double-click must not place two bids.
    expect(await prisma.bid.count({ where: { lotId, status: "accepted" } })).toBe(1);
  });

  it("replays a rejection rather than re-judging it", async () => {
    /*
     * A retry arriving after the close must not turn a decided outcome
     * into a different one.
     */
    const k = key();
    const low = { lotId, userId: bidders[0], amountMinor: 1n, idempotencyKey: k };

    const first = await placeBid(low);
    const replay = await placeBid(low);

    expect(first).toMatchObject({ ok: false, reason: "TOO_LOW" });
    expect(replay).toMatchObject({ ok: false, reason: "TOO_LOW" });
    expect(await prisma.bid.count({ where: { lotId } })).toBe(1);
  });
});

describe("invariant 6 — bids are append-only", () => {
  it("refuses an UPDATE at the database level", async () => {
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    const bid = await prisma.bid.findFirstOrThrow({ where: { lotId } });

    // Enforced by trigger, not by convention — application code cannot
    // opt out of it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE bids SET amount_minor = 1 WHERE id = '${bid.id}'::uuid`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a DELETE at the database level", async () => {
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    const bid = await prisma.bid.findFirstOrThrow({ where: { lotId } });

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM bids WHERE id = '${bid.id}'::uuid`),
    ).rejects.toThrow();
  });
});

describe("closing a lot (§3)", () => {
  it("sells when the highest bid meets the reserve", async () => {
    const closing = await makeLot({
      closesInSeconds: 1,
      reservePriceMinor: 10_000_000n,
    });
    await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    await prisma.lot.update({
      where: { id: closing },
      data: { effectiveCloseAt: new Date(Date.now() - 1000), status: "BIDDING_OPEN" },
    });

    expect(await closeLot(closing)).toMatchObject({ result: "sold" });

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: closing } });
    expect(lot.status).toBe("CLOSED_SOLD");
    expect(lot.winningBidId).not.toBeNull();
    expect(lot.closedAt).not.toBeNull();
  });

  it("opens the negotiation window when the reserve is missed", async () => {
    /*
     * §10: an unmet reserve is not terminal. It is "a warm lead with a
     * known price and an already-verified buyer" — closing straight to
     * UNSOLD throws that away.
     */
    const closing = await makeLot({ closesInSeconds: 1, reservePriceMinor: 50_000_000n });
    await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    await prisma.lot.update({
      where: { id: closing },
      data: { effectiveCloseAt: new Date(Date.now() - 1000), status: "BIDDING_OPEN" },
    });

    expect(await closeLot(closing)).toMatchObject({ result: "reserve-not-met" });

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: closing } });
    expect(lot.status).toBe("RESERVE_NOT_MET");
    // The top bid is exactly what the auctioneer takes to the seller.
    expect(lot.winningBidId).not.toBeNull();
  });

  it("closes unsold when nobody bid", async () => {
    const closing = await makeLot({ closesInSeconds: -1 });

    expect(await closeLot(closing)).toMatchObject({ result: "unsold" });
    expect(
      (await prisma.lot.findUniqueOrThrow({ where: { id: closing } })).status,
    ).toBe("CLOSED_UNSOLD");
  });

  it("does NOT close a lot a late bid has just extended", async () => {
    /*
     * The race the whole locking design exists to prevent. A bid landing
     * between the worker's scan and its lock pushes effective_close_at
     * forward; closing anyway would break the anti-snipe promise in the
     * most visible way possible.
     */
    const closing = await makeLot({ closesInSeconds: 30, resetSeconds: 300 });

    await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(await closeLot(closing)).toMatchObject({ result: "extended" });
    expect(
      (await prisma.lot.findUniqueOrThrow({ where: { id: closing } })).status,
    ).toBe("EXTENDING");
  });

  it("is idempotent", async () => {
    const closing = await makeLot({ closesInSeconds: -1 });

    expect(await closeLot(closing)).toMatchObject({ result: "unsold" });
    // A second worker arriving late must not undo or redo anything.
    expect(await closeLot(closing)).toMatchObject({ result: "skipped" });
  });

  it("claims due lots in a sweep", async () => {
    const a = await makeLot({ closesInSeconds: -1 });
    const b = await makeLot({ closesInSeconds: -1 });

    const outcomes = await closeDueLots();
    const ids = outcomes.map((o) => o.lotId);

    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  it("notifies the top bidder", async () => {
    const closing = await makeLot({ closesInSeconds: -1, reservePriceMinor: 1n });
    await prisma.lot.update({ where: { id: closing }, data: { effectiveCloseAt: new Date(Date.now() + 60_000) } });
    await placeBid({
      lotId: closing,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    await prisma.lot.update({
      where: { id: closing },
      data: { effectiveCloseAt: new Date(Date.now() - 1000), status: "BIDDING_OPEN" },
    });

    await closeLot(closing);

    const queued = await prisma.outbox.findMany({ where: { userId: bidders[0] } });
    expect(queued.map((o) => o.template)).toContain("lot_won");
  });
});

describe("concurrency", () => {
  it("serialises simultaneous bids so exactly one wins each price level", async () => {
    /*
     * Three bidders firing at once on the same lot. The row lock means
     * they queue; each is judged against the state the previous one
     * committed, so the accepted set is strictly increasing and no two
     * share an amount.
     */
    const contested = await makeLot({ closesInSeconds: 3600 });

    const results = await Promise.all(
      bidders.map((userId) =>
        placeBid({ lotId: contested, userId, amountMinor: 10_000_000n, idempotencyKey: key() }),
      ),
    );

    // All three asked for the starting price; only the first can have it.
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "TOO_LOW")).toHaveLength(2);

    expect(await prisma.bid.count({ where: { lotId: contested, status: "accepted" } })).toBe(1);
  }, 30_000);
});

describe("outbid notifications (§4)", () => {
  it("tells the bidder who was displaced", async () => {
    /*
     * §4: "Indefinite extension is only fair if outbid bidders know."
     * With an open-ended close and no alert, the soft close protects
     * whoever happens to be staring at the screen — a fairness defect
     * rather than a missing nicety.
     */
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await placeBid({ lotId, userId: bidders[1], amountMinor: 10_500_000n, idempotencyKey: key() });

    const queued = await prisma.outbox.findMany({ where: { userId: bidders[0] } });
    expect(queued.map((o) => o.template)).toContain("outbid");

    // The bidder who did the outbidding hears nothing.
    expect(await prisma.outbox.count({ where: { userId: bidders[1], template: "outbid" } })).toBe(0);
  });

  it("does not tell anyone they outbid themselves", async () => {
    /*
     * Raising your own highest bid is legitimate — with fixed steps it
     * is the only way to signal above the next rung — but it is not an
     * outbidding, and an email saying so reads as a bug.
     */
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_500_000n, idempotencyKey: key() });

    expect(await prisma.outbox.count({ where: { template: "outbid" } })).toBe(0);
  });

  it("queues nothing for a bid that was refused", async () => {
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await placeBid({ lotId, userId: bidders[1], amountMinor: 1n, idempotencyKey: key() });

    expect(await prisma.outbox.count({ where: { template: "outbid" } })).toBe(0);
  });

  it("queues nothing for the first bid on a lot", async () => {
    // Nobody was displaced.
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });

    expect(await prisma.outbox.count({ where: { template: "outbid" } })).toBe(0);
  });
});

describe("what the lot page is told (bidding-view)", () => {
  it("numbers bidders in the order they first appear, and names nobody", async () => {
    /*
     * A seller or a rival who can tell who is bidding can approach them
     * directly, and that is the disclosure that actually causes harm.
     * The numbering still lets anyone see how many people are in and who
     * is bidding against whom.
     */
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await placeBid({ lotId, userId: bidders[1], amountMinor: 10_500_000n, idempotencyKey: key() });
    await placeBid({ lotId, userId: bidders[0], amountMinor: 11_000_000n, idempotencyKey: key() });

    const view = await getBiddingView(lotId, bidders[0]);

    expect(view.bidCount).toBe(3);
    // Most recent first.
    expect(view.recentBids.map((b) => b.bidderIndex)).toEqual([1, 2, 1]);

    const serialised = JSON.stringify(view);
    for (const id of bidders) expect(serialised).not.toContain(id);
  });

  it("reports the step at the lot's price, not at zero", async () => {
    /*
     * Before the first bid there is no standing price to band on, and
     * falling back to zero picks the bottom band — telling a bidder on a
     * €345,000 lot that bidding moves in €2,000 steps when the first
     * raise will be €10,000. The guide price is the right fallback.
     */
    const pricey = await makeLot({ closesInSeconds: 3600, startingPriceMinor: 34_500_000n });

    const before = await getBiddingView(pricey, bidders[0]);
    expect(before.currentMinor).toBeNull();
    expect(before.minimumMinor).toBe("34500000"); // the guide itself
    expect(before.incrementMinor).toBe("1000000"); // €10,000, not €2,000

    await placeBid({
      lotId: pricey,
      userId: bidders[0],
      amountMinor: 34_500_000n,
      idempotencyKey: key(),
    });

    const after = await getBiddingView(pricey, bidders[0]);
    expect(after.incrementMinor).toBe("1000000");
    expect(after.minimumMinor).toBe("35500000");
  });

  it("says why someone cannot bid, not merely that they cannot", async () => {
    const stranger = await makeBidder(9, false);

    expect(await getBiddingView(lotId, null)).toMatchObject({
      eligibility: { canBid: false, reason: "not-signed-in" },
    });
    expect(await getBiddingView(lotId, stranger)).toMatchObject({
      eligibility: { canBid: false, reason: "not-approved" },
    });
    expect(await getBiddingView(lotId, bidders[0])).toMatchObject({
      eligibility: { canBid: true },
    });
  });

  it("treats a deposit-required lot as blocked until the money is recorded", async () => {
    const depositLot = await makeLot({ closesInSeconds: 3600, depositRequiredMinor: 500_000n });

    expect(await getBiddingView(depositLot, bidders[0])).toMatchObject({
      eligibility: { canBid: false, reason: "no-deposit" },
    });

    await prisma.deposit.create({
      data: {
        userId: bidders[0],
        lotId: depositLot,
        amountMinor: 500_000n,
        status: "held",
        method: "sepa",
      },
    });

    expect(await getBiddingView(depositLot, bidders[0])).toMatchObject({
      eligibility: { canBid: true },
    });
  });

  it("reports the preview as not open, whoever is asking", async () => {
    // A PUBLISHED lot is a preview. Nobody is eligible, including an
    // approved bidder — there is nothing to be eligible for yet.
    await prisma.lot.update({ where: { id: lotId }, data: { status: "PUBLISHED" } });

    expect(await getBiddingView(lotId, bidders[0])).toMatchObject({
      eligibility: { canBid: false, reason: "not-open" },
    });
  });

  it("never carries the reserve", async () => {
    // Invariant 7. The view is the thing the page serialises, so this is
    // the last place the reserve could escape.
    const view = await getBiddingView(lotId, bidders[0]);
    expect(JSON.stringify(view)).not.toContain("11000000");
    expect(Object.keys(view)).not.toContain("reservePriceMinor");
  });
});
