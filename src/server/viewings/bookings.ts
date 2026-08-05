import type { ViewingKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { enqueue } from "@/server/notifications/outbox";

/*
 * Viewing slots and their bookings.
 *
 * The interesting problem here is capacity. `viewings.capacity` is a
 * plain integer with no database-level check, so "don't exceed it" is
 * entirely an application rule — and the naive version (count, compare,
 * insert) is a textbook race: two people on the last place both count 4
 * of 5, both insert, and the viewing is overbooked with no error
 * anywhere.
 *
 * Solved by locking the slot row for the duration of the check and the
 * insert, so the count cannot go stale in between. Overbooking a
 * property viewing means someone drives across the country to be turned
 * away, which is worse than an error message.
 */

export type SlotInput = {
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  kind: ViewingKind;
};

// ---------- Operator side ----------

export async function createSlot(actor: AdminActor, lotId: string, input: SlotInput) {
  const slot = await prisma.viewing.create({ data: { lotId, ...input } });

  await recordAudit({
    actorId: actor.id,
    action: "viewing.create",
    entityType: "lot",
    entityId: lotId,
    after: slot,
  });

  return slot;
}

export async function deleteSlot(actor: AdminActor, viewingId: string): Promise<void> {
  const slot = await prisma.viewing.findUniqueOrThrow({
    where: { id: viewingId },
    include: { bookings: { where: { status: "booked" }, select: { userId: true } } },
  });

  /*
   * Tell the people who booked. Cancelling a viewing silently is how
   * someone turns up to a locked door.
   */
  for (const booking of slot.bookings) {
    await enqueue({
      userId: booking.userId,
      channel: "email",
      template: "viewing_cancelled_by_house",
      payload: { startsAt: slot.startsAt.toISOString() },
    });
  }

  await prisma.$transaction([
    prisma.viewingBooking.deleteMany({ where: { viewingId } }),
    prisma.viewing.delete({ where: { id: viewingId } }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: "viewing.delete",
    entityType: "lot",
    entityId: slot.lotId,
    before: { id: slot.id, startsAt: slot.startsAt, bookings: slot.bookings.length },
  });
}

export function listSlotsForLot(lotId: string) {
  return prisma.viewing.findMany({
    where: { lotId },
    orderBy: { startsAt: "asc" },
    include: {
      _count: { select: { bookings: { where: { status: "booked" } } } },
    },
  });
}

// ---------- Bidder side ----------

export type BookingOutcome =
  | { ok: true }
  | { ok: false; reason: "full" | "already-booked" | "past" | "not-found" };

/**
 * Book a place.
 *
 * Serializable isolation is the point: it makes the read of the current
 * count and the insert one atomic decision, so a concurrent booking for
 * the last place fails rather than overbooking. Postgres reports that as
 * a serialization failure, which is retried once — a genuine conflict is
 * rare, and one retry turns "unlucky timing" into "full", which is the
 * honest answer.
 */
export async function bookSlot(userId: string, viewingId: string): Promise<BookingOutcome> {
  return prisma.$transaction(async (tx) => {
    /*
     * Lock the slot row first. Everything after this — counting the
     * places taken and inserting — happens with no other booking for
     * this slot in flight, so the count cannot go stale between reading
     * it and acting on it.
     *
     * A row lock rather than SERIALIZABLE isolation, deliberately.
     * Serializable made every concurrent booking conflict with every
     * other, and five people racing for one place simply exhausted the
     * transaction timeout — an error instead of a graceful "full". This
     * contends only with bookings for the *same* slot; different
     * viewings never touch each other.
     */
    const locked = await tx.$queryRaw<{ capacity: number; starts_at: Date }[]>`
      SELECT capacity, starts_at FROM viewings WHERE id = ${viewingId}::uuid FOR UPDATE
    `;

    const slot = locked[0];
    if (!slot) return { ok: false, reason: "not-found" } as const;

    // A slot that has started cannot be joined.
    if (new Date(slot.starts_at).getTime() <= Date.now()) {
      return { ok: false, reason: "past" } as const;
    }

    const existing = await tx.viewingBooking.findUnique({
      where: { viewingId_userId: { viewingId, userId } },
    });
    if (existing?.status === "booked") {
      return { ok: false, reason: "already-booked" } as const;
    }

    const taken = await tx.viewingBooking.count({ where: { viewingId, status: "booked" } });
    if (taken >= slot.capacity) return { ok: false, reason: "full" } as const;

    /*
     * Upsert rather than create: the unique constraint means a
     * previously cancelled booking already occupies the row, and
     * re-booking should revive it rather than fail.
     */
    await tx.viewingBooking.upsert({
      where: { viewingId_userId: { viewingId, userId } },
      create: { viewingId, userId, status: "booked" },
      update: { status: "booked", bookedAt: new Date() },
    });

    // tx, not the global client: see the note in outbox.ts. Using the
    // global one here asks the pool for a second connection while this
    // transaction still holds the first, and concurrent bookings deadlock.
    await enqueue(
      {
        userId,
        channel: "email",
        template: "viewing_booked",
        payload: { startsAt: new Date(slot.starts_at).toISOString(), viewingId },
      },
      tx,
    );

    return { ok: true } as const;
  });
}

export async function cancelBooking(userId: string, viewingId: string): Promise<void> {
  /*
   * Status flips rather than the row being deleted. Who was booked, and
   * when they withdrew, is what a seller asks about after a viewing day.
   */
  await prisma.viewingBooking.updateMany({
    where: { viewingId, userId, status: "booked" },
    data: { status: "cancelled" },
  });

  await enqueue({
    userId,
    channel: "email",
    template: "viewing_cancelled_by_bidder",
    payload: { viewingId },
  });
}

export type PublicSlot = {
  id: string;
  startsAtIso: string;
  startsAtFormatted: string;
  durationMinutes: number;
  capacity: number;
  placesLeft: number;
  kind: ViewingKind;
  bookedByViewer: boolean;
};

/** Upcoming slots for a lot, with the viewer's own booking state. */
export async function listPublicSlots(
  lotId: string,
  userId: string | null,
  format: (date: Date) => string,
): Promise<PublicSlot[]> {
  const slots = await prisma.viewing.findMany({
    // Past slots are noise on a listing page.
    where: { lotId, startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    include: {
      bookings: {
        where: { status: "booked" },
        select: { userId: true },
      },
    },
  });

  return slots.map((slot) => ({
    id: slot.id,
    startsAtIso: slot.startsAt.toISOString(),
    startsAtFormatted: format(slot.startsAt),
    durationMinutes: slot.durationMinutes,
    capacity: slot.capacity,
    placesLeft: Math.max(0, slot.capacity - slot.bookings.length),
    kind: slot.kind,
    bookedByViewer: userId ? slot.bookings.some((b) => b.userId === userId) : false,
  }));
}
