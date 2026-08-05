import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookSlot, cancelBooking } from "@/server/viewings/bookings";

/*
 * Booking, against the real database.
 *
 * The capacity rule is the reason this is not mocked. `viewings.capacity`
 * has no database-level check, so "don't exceed it" is an application
 * rule — and the interesting failure is concurrent, which a mock cannot
 * reproduce.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-view-";

let lotId: string;
let userIds: string[] = [];

async function makeUser(n: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}${n}-${Date.now()}@example.bg`,
      passwordHash: "not-used-here",
      firstName: "Тест",
      lastName: `Потребител${n}`,
      dateOfBirth: new Date("1990-01-01"),
      accountType: "individual",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function makeSlot(capacity: number, startsInHours = 48): Promise<string> {
  const slot = await prisma.viewing.create({
    data: {
      lotId,
      startsAt: new Date(Date.now() + startsInHours * 3600_000),
      durationMinutes: 30,
      capacity,
      kind: "open_house",
    },
    select: { id: true },
  });
  return slot.id;
}

async function cleanup() {
  await prisma.viewingBooking.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.viewing.deleteMany({ where: { lot: { property: { slug: "dvustaen-karshiyaka-plovdiv" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: "dvustaen-karshiyaka-plovdiv" } },
  });
  lotId = lot.id;
  userIds = await Promise.all([0, 1, 2, 3, 4].map(makeUser));
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("booking a place", () => {
  it("succeeds while there is room", async () => {
    const viewingId = await makeSlot(2);

    await expect(bookSlot(userIds[0], viewingId)).resolves.toEqual({ ok: true });
    await expect(bookSlot(userIds[1], viewingId)).resolves.toEqual({ ok: true });
  });

  it("refuses once the slot is full", async () => {
    const viewingId = await makeSlot(1);

    await bookSlot(userIds[0], viewingId);
    await expect(bookSlot(userIds[1], viewingId)).resolves.toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("refuses a second booking by the same person", async () => {
    // A double-click must not consume two places.
    const viewingId = await makeSlot(5);

    await bookSlot(userIds[0], viewingId);
    await expect(bookSlot(userIds[0], viewingId)).resolves.toEqual({
      ok: false,
      reason: "already-booked",
    });

    expect(await prisma.viewingBooking.count({ where: { viewingId, status: "booked" } })).toBe(1);
  });

  it("refuses a slot that has already started", async () => {
    const viewingId = await makeSlot(5, -1);
    await expect(bookSlot(userIds[0], viewingId)).resolves.toEqual({ ok: false, reason: "past" });
  });

  it("refuses an unknown slot", async () => {
    await expect(
      bookSlot(userIds[0], "11111111-1111-1111-1111-111111111111"),
    ).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("queues a confirmation", async () => {
    // §5: "confirmations and reminders ride the same outbox".
    const viewingId = await makeSlot(2);
    await bookSlot(userIds[0], viewingId);

    const queued = await prisma.outbox.findMany({ where: { userId: userIds[0] } });
    expect(queued.map((o) => o.template)).toContain("viewing_booked");
  });
});

describe("capacity under concurrency", () => {
  it("never overbooks when several people race for the last place", async () => {
    /*
     * The bug this exists to prevent: count, compare, insert is not
     * atomic, so two people both see 0 of 1 taken and both insert. The
     * result is a viewing with more attendees than places and no error
     * anywhere — someone drives across the country to be turned away.
     *
     * Serializable isolation makes the database refuse the loser.
     */
    const viewingId = await makeSlot(1);

    const results = await Promise.all(userIds.map((userId) => bookSlot(userId, viewingId)));

    const succeeded = results.filter((r) => r.ok).length;
    expect(succeeded).toBe(1);

    const booked = await prisma.viewingBooking.count({ where: { viewingId, status: "booked" } });
    expect(booked).toBe(1);
  }, 30_000);

  it("fills exactly to capacity when demand exceeds it", async () => {
    const viewingId = await makeSlot(3);

    const results = await Promise.all(userIds.map((userId) => bookSlot(userId, viewingId)));

    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(await prisma.viewingBooking.count({ where: { viewingId, status: "booked" } })).toBe(3);
  }, 30_000);
});

describe("cancelling", () => {
  it("frees the place for someone else", async () => {
    const viewingId = await makeSlot(1);

    await bookSlot(userIds[0], viewingId);
    await expect(bookSlot(userIds[1], viewingId)).resolves.toMatchObject({ reason: "full" });

    await cancelBooking(userIds[0], viewingId);

    await expect(bookSlot(userIds[1], viewingId)).resolves.toEqual({ ok: true });
  });

  it("keeps the row as a record rather than deleting it", async () => {
    /*
     * Who was booked and when they withdrew is what a seller asks about
     * after a viewing day.
     */
    const viewingId = await makeSlot(2);

    await bookSlot(userIds[0], viewingId);
    await cancelBooking(userIds[0], viewingId);

    const row = await prisma.viewingBooking.findUniqueOrThrow({
      where: { viewingId_userId: { viewingId, userId: userIds[0] } },
    });
    expect(row.status).toBe("cancelled");
  });

  it("lets the same person book again afterwards", async () => {
    // The unique constraint means the old row is revived, not duplicated.
    const viewingId = await makeSlot(2);

    await bookSlot(userIds[0], viewingId);
    await cancelBooking(userIds[0], viewingId);
    await expect(bookSlot(userIds[0], viewingId)).resolves.toEqual({ ok: true });

    expect(
      await prisma.viewingBooking.count({ where: { viewingId, userId: userIds[0] } }),
    ).toBe(1);
  });
});
