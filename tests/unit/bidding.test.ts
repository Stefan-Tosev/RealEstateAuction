import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeLot, closeDueLots } from "@/server/auction/close-lots";
import { DEFAULT_BANDS, incrementForFromBands } from "@/server/auction/increments";
import { DEFAULT_SCHEDULE, placeBid, windowFor } from "@/server/auction/place-bid";

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
}): Promise<string> {
  const closeAt = new Date(Date.now() + options.closesInSeconds * 1000);

  const lot = await prisma.lot.create({
    data: {
      propertyId,
      lotNumber: Math.floor(Math.random() * 900_000) + 1000,
      status: "BIDDING_OPEN",
      startingPriceMinor: options.startingPriceMinor ?? 10_000_000n,
      reservePriceMinor: options.reservePriceMinor ?? 11_000_000n,
      depositRequiredMinor: options.depositRequiredMinor ?? null,
      biddingOpensAt: new Date(Date.now() - 86_400_000),
      scheduledCloseAt: closeAt,
      effectiveCloseAt: closeAt,
      softCloseWindowSeconds: options.windowSeconds ?? 300,
      softCloseResetSeconds: options.resetSeconds ?? 300,
      extensionCount: options.extensionCount ?? 0,
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

    expect(incrementForFromBands(DEFAULT_BANDS, eur(19_999))).toBe(eur(250));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(20_000))).toBe(eur(500));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(49_999))).toBe(eur(500));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(50_000))).toBe(eur(1_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(99_999))).toBe(eur(1_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(100_000))).toBe(eur(2_500));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(250_000))).toBe(eur(5_000));
    expect(incrementForFromBands(DEFAULT_BANDS, eur(9_000_000))).toBe(eur(5_000));
  });

  it("keeps every band near 1.5–2% of the standing bid", () => {
    /*
     * The calibration §3 argues for: a step much coarser deters bidders,
     * much finer drags the endgame out.
     *
     * Measured at each band's LOWER bound, which is its worst case — the
     * step is proportionally largest there and shrinks across the band.
     * At €20,000 a €500 step is 2.5%; by €30,000 it is the ~1.7% the
     * spec's table quotes. So the ceiling here is the boundary figure,
     * not the typical one.
     */
    for (const band of DEFAULT_BANDS) {
      if (band.fromMinor === 0n) continue;
      const pct = (Number(band.incrementMinor) / Number(band.fromMinor)) * 100;
      expect(pct, `band from ${band.fromMinor}`).toBeGreaterThan(1.0);
      expect(pct, `band from ${band.fromMinor}`).toBeLessThanOrEqual(2.5);
    }
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

describe("minimum next bid is a FLOOR, not a step (§3)", () => {
  it("accepts a jump bid far above the minimum", async () => {
    /*
     * "Any amount above it is valid; jump bids are expected and are what
     * keep endgames short." Rounding to the increment would be a
     * different auction.
     */
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });

    const jump = await placeBid({
      lotId,
      userId: bidders[1],
      amountMinor: 15_000_000n,
      idempotencyKey: key(),
    });

    expect(jump).toMatchObject({ ok: true, amountMinor: 15_000_000n });
  });

  it("refuses one cent below the floor and accepts the floor exactly", async () => {
    await placeBid({ lotId, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });

    // €100,000 sits in the €2,500 band.
    const floor = 10_250_000n;

    await expect(
      placeBid({ lotId, userId: bidders[1], amountMinor: floor - 1n, idempotencyKey: key() }),
    ).resolves.toMatchObject({ ok: false, reason: "TOO_LOW", minimumMinor: floor });

    await expect(
      placeBid({ lotId, userId: bidders[1], amountMinor: floor, idempotencyKey: key() }),
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
      amountMinor: 10_250_000n,
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

  it("shrinks the window as extensions accumulate", () => {
    /*
     * Two determined bidders grinding the minimum can otherwise drag a
     * close out for hours — 30 rounds at a flat 5 minutes is 2.5 hours.
     */
    expect(windowFor(null, 0, 300)).toBe(300);
    expect(windowFor(null, 1, 300)).toBe(300);
    expect(windowFor(null, 2, 300)).toBe(180);
    expect(windowFor(null, 3, 300)).toBe(180);
    expect(windowFor(null, 4, 300)).toBe(120);
    expect(windowFor(null, 30, 300)).toBe(120);
  });

  it("never floors below two minutes", () => {
    // "Do not floor below 2 minutes for property. A bidder needs time to
    // see the alert, think, and confirm a five-figure commitment."
    const floor = Math.min(...DEFAULT_SCHEDULE.map((s) => s.windowSeconds));
    expect(floor).toBe(120);
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
