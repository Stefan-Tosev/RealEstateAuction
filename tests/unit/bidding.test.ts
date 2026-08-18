import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeLot, closeDueLots } from "@/server/auction/close-lots";
import { acceptTopBid, declineTopBid, expireNegotiationWindows } from "@/server/auction/negotiation";
import { DEFAULT_BANDS, incrementForFromBands } from "@/server/auction/increments";
import { DEFAULT_SCHEDULE, placeBid, windowFor } from "@/server/auction/place-bid";
import { getBiddingView } from "@/server/auction/bidding-view";
import {
  POLICY_VERSION,
  hasAcceptedCurrentTerms,
  recordTermsAcceptance,
} from "@/server/identity/terms";

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
/** A real admin row: the audit trail has a foreign key to it. */
let ADMIN_ID = "";
let ADMIN_ACTOR: { id: string; email: string; role: "admin" };

/*
 * A bidder as registration would leave one: approved, and holding a
 * granted terms consent at the current version.
 *
 * The consent is not decoration. placeBid refuses anyone whose latest
 * terms consent does not match POLICY_VERSION, so a fixture without one
 * is not a simplified bidder -- it is a bidder who never agreed to
 * anything, and every test built on it would be testing the refusal.
 * Pass `termsVersion` to build the stale and never-accepted cases.
 */
async function makeBidder(
  n: number,
  approved = true,
  termsVersion: string | null = POLICY_VERSION,
): Promise<string> {
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

  if (termsVersion !== null) {
    await prisma.consent.create({
      data: {
        userId: user.id,
        kind: "terms",
        granted: true,
        policyVersion: termsVersion,
        wording: "Приемам общите условия.",
      },
    });
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
  // Sales before users: sales_user_id_fkey is RESTRICT, because a
  // completion in progress should not vanish with a deleted account.
  await prisma.sale.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  // Lots created here hang off the seeded property; winningBidId must go first.
  await prisma.sale.deleteMany({ where: { lot: { property: { slug: PREFIX + "prop" } } } });
  await prisma.fee.deleteMany({ where: { lot: { property: { slug: PREFIX + "prop" } } } });
  await prisma.lot.updateMany({ where: { property: { slug: PREFIX + "prop" } }, data: { winningBidId: null } });
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { lot: { property: { slug: PREFIX + "prop" } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.lot.deleteMany({ where: { property: { slug: PREFIX + "prop" } } });
  await prisma.property.deleteMany({ where: { slug: PREFIX + "prop" } });
  await prisma.outbox.deleteMany({ where: { seller: { name: { startsWith: PREFIX } } } });
  await prisma.seller.deleteMany({ where: { name: { startsWith: PREFIX } } });
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

  const admin = await prisma.adminUser.findFirstOrThrow({ select: { id: true, email: true } });
  ADMIN_ID = admin.id;
  ADMIN_ACTOR = { id: admin.id, email: admin.email, role: "admin" };
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

describe("fees fall due at the right moments (§10)", () => {
  it("raises commission and premium on the hammer price when a lot sells", async () => {
    const lot = await makeLot({
      closesInSeconds: 3600,
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: 10_000_000n,
    });
    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    const fees = await prisma.fee.findMany({ where: { lotId: lot }, orderBy: { kind: "asc" } });
    expect(fees.map((f) => `${f.party}.${f.kind}`).sort()).toEqual([
      "buyer.premium",
      "seller.commission",
    ]);

    // 2.5% of €100,000, plus ДДС on the commission rather than on the sale.
    for (const fee of fees) {
      expect(fee.netMinor).toBe(250_000n);
      expect(fee.vatMinor).toBe(50_000n);
      expect(fee.baseMinor).toBe(10_000_000n);
    }

    // The premium is owed by a person we can name; the seller is not
    // modelled yet, so their row carries the lot alone.
    const premium = fees.find((f) => f.kind === "premium")!;
    expect(premium.userId).toBe(bidders[0]);
    expect(fees.find((f) => f.kind === "commission")!.userId).toBeNull();
  });

  it("raises nothing while a lot is only in the negotiation window", async () => {
    /*
     * RESERVE_NOT_MET is not a sale. Billing a commission there would
     * charge a seller for a transaction that may never happen.
     */
    const lot = await makeLot({
      closesInSeconds: 3600,
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: 20_000_000n,
    });
    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    expect(await prisma.fee.count({ where: { lotId: lot } })).toBe(0);

    // ...and raises them on the amount actually agreed once it sells,
    // which is below the reserve.
    await acceptTopBid(ADMIN_ACTOR, lot, null);

    const commission = await prisma.fee.findFirstOrThrow({
      where: { lotId: lot, kind: "commission" },
    });
    expect(commission.baseMinor).toBe(10_000_000n);
    expect(commission.netMinor).toBe(250_000n);
  });

  it("does not raise a second commission when a close runs twice", async () => {
    /*
     * Idempotent by unique constraint rather than by checking first. Two
     * workers racing, or a retry, must not bill the seller twice.
     */
    const lot = await makeLot({
      closesInSeconds: 3600,
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: 10_000_000n,
    });
    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });

    await closeLot(lot);
    await prisma.lot.update({
      where: { id: lot },
      data: { status: "BIDDING_OPEN", effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    expect(await prisma.fee.count({ where: { lotId: lot, kind: "commission" } })).toBe(1);
  });
});

describe("the post-auction negotiation window (§10)", () => {
  /*
   * An unmet reserve used to be a dead end: RESERVE_NOT_MET had no
   * onward transition, so the one ending with a verified buyer, money
   * already down and a known price was the one the system could not
   * finish.
   */
  async function closeUnderReserve(options: { negotiationHours?: number } = {}) {
    /*
     * An hour out, so the bid lands well outside the soft-close window
     * and does not extend the clock — then the close is moved into the
     * past. Bidding on a lot that is seconds from closing extends it by
     * five minutes, which is the engine working correctly and a slow way
     * to write this test.
     */
    const lot = await makeLot({
      closesInSeconds: 3600,
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: 20_000_000n,
    });

    await placeBid({
      lotId: lot,
      userId: bidders[0],
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    await prisma.deposit.createMany({
      data: [
        { userId: bidders[0], lotId: lot, amountMinor: 500_000n, status: "held", method: "sepa" },
        { userId: bidders[1], lotId: lot, amountMinor: 500_000n, status: "held", method: "sepa" },
      ],
    });

    await prisma.lot.update({
      where: { id: lot },
      data: {
        effectiveCloseAt: new Date(Date.now() - 1000),
        ...(options.negotiationHours === undefined
          ? {}
          : { negotiationHours: options.negotiationHours }),
      },
    });

    await closeLot(lot);
    return lot;
  }

  it("opens a window and holds only the top bidder's deposit", async () => {
    const lotId = await closeUnderReserve({ negotiationHours: 48 });

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe("RESERVE_NOT_MET");
    expect(lot.negotiationEndsAt).not.toBeNull();

    const hoursOut = (lot.negotiationEndsAt!.getTime() - Date.now()) / 3_600_000;
    expect(hoursOut).toBeGreaterThan(47);
    expect(hoursOut).toBeLessThan(49);

    // §10: the top bidder's stays held for the duration. The losing
    // bidder's goes back now, not when somebody remembers.
    const top = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: bidders[0] } });
    const losing = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: bidders[1] } });
    expect(top.status).toBe("held");
    expect(losing.status).toBe("released");
    expect(
      await prisma.outbox.count({ where: { userId: bidders[1], template: "deposit_released" } }),
    ).toBe(1);
  });

  it("sells at the bid when the seller accepts, leaving the reserve on the record", async () => {
    const lotId = await closeUnderReserve();
    await acceptTopBid(ADMIN_ACTOR, lotId, "Agreed by phone");

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe("CLOSED_SOLD");
    expect(lot.negotiationEndsAt).toBeNull();
    // Not rewritten to the sale price — the gap is the evidence a
    // negotiation happened at all.
    expect(lot.reservePriceMinor).toBe(20_000_000n);

    expect(
      await prisma.outbox.count({ where: { userId: bidders[0], template: "lot_won" } }),
    ).toBe(1);

    // The buyer now owes the purchase price; the deposit secures it.
    const top = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: bidders[0] } });
    expect(top.status).toBe("held");
  });

  it("closes unsold and returns the money when the seller declines", async () => {
    const lotId = await closeUnderReserve();
    await declineTopBid(ADMIN_ACTOR, lotId, "Holding out");

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe("CLOSED_UNSOLD");

    // §10: "Deposit refunded in full, no exceptions."
    const top = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: bidders[0] } });
    expect(top.status).toBe("released");
  });

  it("expires on the clock, exactly as a decline does", async () => {
    /*
     * An expiry is a decline nobody got round to making. A bidder's money
     * cannot stay held because an auctioneer was on holiday.
     */
    const lotId = await closeUnderReserve();
    await prisma.lot.update({
      where: { id: lotId },
      data: { negotiationEndsAt: new Date(Date.now() - 1000) },
    });

    const expired = await expireNegotiationWindows();
    expect(expired).toContain(lotId);

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe("CLOSED_UNSOLD");

    const top = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: bidders[0] } });
    expect(top.status).toBe("released");

    // Nobody decided this, so no name goes against it.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: lotId, action: "lot.negotiationExpired" },
    });
    expect(audit.actorUserId).toBeNull();
  });

  it("does not expire a window that is still running", async () => {
    const lotId = await closeUnderReserve({ negotiationHours: 48 });

    expect(await expireNegotiationWindows()).not.toContain(lotId);
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe("RESERVE_NOT_MET");
  });

  it("refuses to conclude a lot that is not in a window", async () => {
    // Guards the double-click and the stale tab: accepting twice would
    // otherwise release a deposit that a sale is relying on.
    const lotId = await closeUnderReserve();
    await acceptTopBid(ADMIN_ACTOR, lotId, null);

    await expect(
      acceptTopBid(ADMIN_ACTOR, lotId, null),
    ).rejects.toThrow(/not in a negotiation window/);
  });

  it("records who concluded it and what they said", async () => {
    const lotId = await closeUnderReserve();
    await acceptTopBid(ADMIN_ACTOR, lotId, "Seller agreed on the phone");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: lotId, action: "lot.negotiationAccepted" },
    });
    expect(audit.actorUserId).toBe(ADMIN_ID);
    expect(JSON.stringify(audit.after)).toContain("Seller agreed on the phone");
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

describe("the seller's bid log (§3 access design)", () => {
  /*
   * The second half of what place-bid.ts has promised since Phase 3: "a
   * seller sees the same public price everyone does, never bidder
   * identities, and gets a full anonymised bid log after close."
   *
   * The first half has been enforced all along. This is the part that
   * was owed.
   */
  async function lotWithSeller(reserveMinor: bigint) {
    const seller = await prisma.seller.create({
      data: { name: `${PREFIX}seller`, email: `${PREFIX}seller@example.bg`, locale: "en" },
      select: { id: true },
    });
    await prisma.property.update({
      where: { slug: PREFIX + "prop" },
      data: { sellerId: seller.id },
    });

    const lot = await makeLot({
      closesInSeconds: 3600,
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: reserveMinor,
    });
    return { sellerId: seller.id, lotId: lot };
  }

  it("goes to the seller, naming nobody", async () => {
    const { sellerId, lotId: lot } = await lotWithSeller(10_000_000n);

    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await placeBid({ lotId: lot, userId: bidders[1], amountMinor: 10_500_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    const message = await prisma.outbox.findFirstOrThrow({
      where: { sellerId, template: "lot_bid_log" },
    });

    // Addressed to the seller, not to a bidder.
    expect(message.userId).toBeNull();

    const payload = message.payload as { summary: string; log: string };
    expect(payload.summary).toContain("sold for");
    expect(payload.log).toContain("Bidder 1");
    expect(payload.log).toContain("Bidder 2");

    /*
     * The whole point. A seller who can tell WHO bid can approach the
     * underbidder and complete off-platform — costing the house its
     * commission and the buyer their protections.
     */
    const serialised = JSON.stringify(payload);
    for (const id of bidders) expect(serialised).not.toContain(id);
  });

  it("is sent even when nothing sold, which is when it is most owed", async () => {
    const { sellerId, lotId: lot } = await lotWithSeller(90_000_000n);

    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    const message = await prisma.outbox.findFirstOrThrow({
      where: { sellerId, template: "lot_bid_log" },
    });
    const payload = message.payload as { summary: string; log: string };

    expect(payload.summary).toMatch(/without a single bid/i);
    expect(payload.log).toContain("no bids");
  });

  it("tells a seller whose reserve was missed what the market actually said", async () => {
    const { sellerId, lotId: lot } = await lotWithSeller(90_000_000n);

    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    const message = await prisma.outbox.findFirstOrThrow({
      where: { sellerId, template: "lot_bid_log" },
    });
    const payload = message.payload as { summary: string };
    expect(payload.summary).toMatch(/did not reach your reserve/i);
  });

  it("writes in the seller's language, not the site default", async () => {
    const { sellerId, lotId: lot } = await lotWithSeller(10_000_000n);
    await prisma.seller.update({ where: { id: sellerId }, data: { locale: "bg" } });

    await placeBid({ lotId: lot, userId: bidders[0], amountMinor: 10_000_000n, idempotencyKey: key() });
    await prisma.lot.update({
      where: { id: lot },
      data: { effectiveCloseAt: new Date(Date.now() - 1000) },
    });
    await closeLot(lot);

    const message = await prisma.outbox.findFirstOrThrow({
      where: { sellerId, template: "lot_bid_log" },
    });
    expect((message.payload as { log: string }).log).toContain("Наддаващ");
  });
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

describe("terms acceptance binds a bid to a named version", () => {
  /*
   * A bid is binding because the bidder accepted terms saying so. That
   * is only provable if the version they accepted is the version in
   * force — consent was captured once at registration and nothing
   * re-asked, so bumping the policy left everyone bidding under text
   * they had never seen while the record honestly said otherwise.
   */


  it("refuses a bidder still on an older version", async () => {
    const stale = await makeBidder(60, true, "2025-01-01");

    const outcome = await placeBid({
      lotId,
      userId: stale,
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(outcome).toMatchObject({ ok: false, reason: "TERMS_OUTDATED" });
  });

  it("refuses a bidder who never accepted any terms", async () => {
    // Registration always writes one, so an absent consent means the row
    // came from somewhere else. That is not grounds to treat them as
    // bound.
    const never = await makeBidder(61, true, null);

    const outcome = await placeBid({
      lotId,
      userId: never,
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });

    expect(outcome).toMatchObject({ ok: false, reason: "TERMS_OUTDATED" });
  });

  it("records the refusal as a bid, so the attempt survives", async () => {
    const stale = await makeBidder(62, true, "2025-01-01");
    await placeBid({ lotId, userId: stale, amountMinor: 10_000_000n, idempotencyKey: key() });

    const bid = await prisma.bid.findFirst({ where: { lotId, userId: stale } });
    expect(bid).toMatchObject({ status: "rejected", rejectReason: "TERMS_OUTDATED" });
  });

  it("accepts once the current version is accepted, and keeps the old row", async () => {
    const stale = await makeBidder(63, true, "2025-01-01");

    await recordTermsAcceptance(prisma, {
      userId: stale,
      wording: "Приемам новите общи условия.",
      ip: "203.0.113.7",
    });

    const outcome = await placeBid({
      lotId,
      userId: stale,
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: true });

    /*
     * Append, never update. The earlier row is the evidence of what was
     * agreed at the time; a trail whose value is the sequence cannot
     * have the sequence overwritten.
     */
    const consents = await prisma.consent.findMany({
      where: { userId: stale, kind: "terms" },
      orderBy: { createdAt: "asc" },
      select: { policyVersion: true, wording: true },
    });
    expect(consents).toHaveLength(2);
    expect(consents[0].policyVersion).toBe("2025-01-01");
    expect(consents[1].policyVersion).toBe(POLICY_VERSION);
  });

  it("sees a fresh acceptance even when it lands in the same millisecond", async () => {
    /*
     * The regression CI found. createdAt is millisecond-resolution, so
     * ordering by it and taking the newest returns either row when two
     * land in one tick — and the bidder who had just accepted was told
     * they had not. Written back to back on purpose: on a fast enough
     * machine these two rows share a timestamp, and the check must not
     * care.
     */
    const bidder = await makeBidder(64, true, null);

    /*
     * Forced rather than raced. Writing the two rows back to back only
     * collides on a machine quick enough to fit both in one tick, which
     * is precisely why this passed here and failed in CI. Stamping both
     * with the same instant reproduces it everywhere, every run.
     */
    const sameInstant = new Date();
    await prisma.consent.createMany({
      data: [
        {
          userId: bidder,
          kind: "terms",
          granted: true,
          policyVersion: "2025-01-01",
          wording: "Стари условия.",
          createdAt: sameInstant,
        },
        {
          userId: bidder,
          kind: "terms",
          granted: true,
          policyVersion: POLICY_VERSION,
          wording: "Приемам.",
          createdAt: sameInstant,
        },
      ],
    });

    expect(await hasAcceptedCurrentTerms(prisma, bidder)).toBe(true);

    // And the bid itself goes through, which is the part the bidder sees.
    const outcome = await placeBid({
      lotId,
      userId: bidder,
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: true });
  });

  it("ignores a revoked consent", async () => {
    // A withdrawn consent is a fact worth keeping and not one worth
    // acting on.
    const bidder = await makeBidder(65, true, null);
    await prisma.consent.create({
      data: {
        userId: bidder,
        kind: "terms",
        granted: true,
        policyVersion: POLICY_VERSION,
        wording: "Приемам.",
        revokedAt: new Date(),
      },
    });

    expect(await hasAcceptedCurrentTerms(prisma, bidder)).toBe(false);
  });

  it("ignores a recorded refusal", async () => {
    // Evidence, never permission.
    const bidder = await makeBidder(66, true, null);
    await prisma.consent.create({
      data: {
        userId: bidder,
        kind: "terms",
        granted: false,
        policyVersion: POLICY_VERSION,
        wording: "Приемам.",
      },
    });

    expect(await hasAcceptedCurrentTerms(prisma, bidder)).toBe(false);
  });

  it("tells the lot page why, before the bidder tries", async () => {
    /*
     * The panel and the gate must agree. If the page says a bidder may
     * bid and placeBid then refuses, the page has promised something the
     * engine will not honour — and the bidder finds out by losing a lot.
     */
    const stale = await makeBidder(68, true, "2025-01-01");
    const view = await getBiddingView(lotId, stale);

    expect(view.eligibility).toEqual({ canBid: false, reason: "terms-outdated" });
  });

  it("stamps every bid with the version in force when it arrived", async () => {
    const bidder = await makeBidder(67);
    const outcome = await placeBid({
      lotId,
      userId: bidder,
      amountMinor: 10_000_000n,
      idempotencyKey: key(),
    });
    expect(outcome.ok).toBe(true);

    /*
     * The constant moves on; the stamp does not. That is the whole
     * point — POLICY_VERSION tells you what the terms are today, and
     * only the bid can tell you what they were when it was placed.
     */
    const bid = await prisma.bid.findFirst({ where: { lotId, userId: bidder } });
    expect(bid?.policyVersion).toBe(POLICY_VERSION);
  });
});
